
import { EntityDataProvider, EntityDataProviderFindOptions, DataProvider } from "../data-interfaces";
import { SqlCommand, SqlImplementation, SqlResult } from "../sql-command";
import { Column } from "../column";
import { Entity } from "../entity";
import { FilterConsumerBridgeToSqlRequest } from "../filter/filter-consumer-bridge-to-sql-request";
import { CompoundIdColumn } from "../columns/compound-id-column";
import { FilterBase } from '../filter/filter-interfaces';

// @dynamic
export class SqlDatabase implements DataProvider {
  createCommand(): SqlCommand {
    return new LogSQLCommand(this.sql.createCommand(), SqlDatabase.LogToConsole);
  }
  async execute(sql: string) {
    return await this.createCommand().execute(sql);
  }
  getEntityDataProvider(entity: Entity): EntityDataProvider {

    return new ActualSQLServerDataProvider(entity, this, async () => {
      if (this.createdEntities.indexOf(entity.defs.dbName) < 0) {
        this.createdEntities.push(entity.defs.dbName);
        await this.sql.entityIsUsedForTheFirstTime(entity);
      }
    });
  }
  transaction(action: (dataProvider: DataProvider) => Promise<void>): Promise<void> {
    return this.sql.transaction(async x => {
      let completed = false;
      try {
        await action(new SqlDatabase({
          createCommand: () => {
            let c = x.createCommand();
            return {
              addParameterAndReturnSqlToken:x=> c.addParameterAndReturnSqlToken(x),
              execute: async (sql) => {
                if (completed)
                  throw "can't run a command after the transaction was completed";
                return c.execute(sql)
              }
            };
          },
          entityIsUsedForTheFirstTime:y=> x.entityIsUsedForTheFirstTime(y),
          transaction: z=>x.transaction(z)
        }))
      }
      finally {
        completed = true;
      }
    });
  }
  public static LogToConsole = false;
  public static durationThreshold = 0;
  constructor(private sql: SqlImplementation) {

  }
  private createdEntities: string[] = [];
}



class LogSQLCommand implements SqlCommand {
  constructor(private origin: SqlCommand, private allQueries: boolean) {

  }

  args: any = {};
  addParameterAndReturnSqlToken(val: any): string {
    let r = this.origin.addParameterAndReturnSqlToken(val);
    this.args[r] = val;
    return r;
  }
  async execute(sql: string): Promise<SqlResult> {

    try {
      let start = new Date();
      let r = await this.origin.execute(sql);
      if (this.allQueries) {
        var d = new Date().valueOf() - start.valueOf();
        if (d > SqlDatabase.durationThreshold) {
          console.log('Query:', sql);
          console.log("Arguments:", this.args);
          console.log("Duration", d / 1000);
        }
      }
      return r;
    }
    catch (err) {
      console.error('Error:', err);
      console.error('Query:', sql);
      console.error("Arguments", this.args);
      throw err;
    }
  }
}

class ActualSQLServerDataProvider implements EntityDataProvider {
  public static LogToConsole = false;
  constructor(private entity: Entity, private sql: SqlDatabase, private iAmUsed: () => Promise<void>) {


  }



  async count(where: FilterBase): Promise<number> {
    await this.iAmUsed();
    let select = 'select count(*) count from ' + this.entity.defs.dbName;
    let r = this.sql.createCommand();
    if (where) {
      let wc = new FilterConsumerBridgeToSqlRequest(r);
      where.__applyToConsumer(wc);
      select += wc.where;
    }

    return r.execute(select).then(r => {
      return +r.rows[0].count;
    });

  }
  async find(options?: EntityDataProviderFindOptions): Promise<any[]> {
    await this.iAmUsed();
    let select = 'select ';
    let colKeys: Column[] = [];
    for (const x of this.entity.columns) {
      if (x.defs.__isVirtual()) {

      }
      else {
        if (colKeys.length > 0)
          select += ', ';
        select += x.defs.dbName;
        colKeys.push(x);
      }
    }

    select += '\n from ' + this.entity.defs.dbName;
    let r = this.sql.createCommand();
    if (options) {
      if (options.where) {
        let where = new FilterConsumerBridgeToSqlRequest(r);
        options.where.__applyToConsumer(where);
        select += where.where;
      }
      if (options.orderBy) {
        let first = true;
        options.orderBy.Segments.forEach(c => {
          if (first) {
            select += ' Order By ';
            first = false;
          }
          else
            select += ', ';
          select += c.column.defs.dbName;
          if (c.descending)
            select += ' desc';
        });

      }

      if (options.limit) {

        let page = 1;
        if (options.page)
          page = options.page;
        if (page < 1)
          page = 1;
        select += ' limit ' + options.limit + ' offset ' + (page - 1) * options.limit;
      }
    }

    return r.execute(select).then(r => {
      return r.rows.map(y => {
        let result: any = {};
        for (let index = 0; index < colKeys.length; index++) {
          const col = colKeys[index];
          result[col.defs.key] = col.__getStorage().fromDb(y[r.getColumnKeyInResultForIndexInSelect(index)]);
        }
        return result;
      });
    });
  }
  async update(id: any, data: any): Promise<any> {
    await this.iAmUsed();

    let r = this.sql.createCommand();
    let f = new FilterConsumerBridgeToSqlRequest(r);
    this.entity.columns.idColumn.isEqualTo(id).__applyToConsumer(f);
    let statement = 'update ' + this.entity.defs.dbName + ' set ';
    let added = false;
    let resultFilter = this.entity.columns.idColumn.isEqualTo(id);
    if (data.id != undefined)
      resultFilter = this.entity.columns.idColumn.isEqualTo(data.id);
    for (const x of this.entity.columns) {
      if (x instanceof CompoundIdColumn) {
        resultFilter = x.resultIdFilter(id, data);
      } if (x.defs.dbReadOnly) { }
      else {
        let v = x.__getStorage().toDb(data[x.defs.key]);
        if (v != undefined) {
          if (!added)
            added = true;
          else
            statement += ', ';

          statement += x.defs.dbName + ' = ' + r.addParameterAndReturnSqlToken(v);
        }
      }
    }

    statement += f.where;

    return r.execute(statement).then(() => {
      return this.find({ where: resultFilter }).then(y => y[0]);
    });


  }
  async delete(id: any): Promise<void> {
    await this.iAmUsed();

    let r = this.sql.createCommand();
    let f = new FilterConsumerBridgeToSqlRequest(r);
    this.entity.columns.idColumn.isEqualTo(id).__applyToConsumer(f);
    let statement = 'delete from ' + this.entity.defs.dbName;
    let added = false;

    statement += f.where;

    return r.execute(statement).then(() => {
      return this.find({ where: this.entity.columns.idColumn.isEqualTo(id) }).then(y => y[0]);
    });

  }
  async insert(data: any): Promise<any> {
    await this.iAmUsed();

    let r = this.sql.createCommand();
    let f = new FilterConsumerBridgeToSqlRequest(r);


    let cols = '';
    let vals = '';
    let added = false;
    let resultFilter = this.entity.columns.idColumn.isEqualTo(data[this.entity.columns.idColumn.defs.key]);
    for (const x of this.entity.columns) {
      if (x instanceof CompoundIdColumn) {
        resultFilter = x.resultIdFilter(undefined, data);
      }
      if (x.defs.dbReadOnly) { }

      else {
        let v = x.__getStorage().toDb(data[x.defs.key]);
        if (v != undefined) {
          if (!added)
            added = true;
          else {
            cols += ', ';
            vals += ', ';
          }

          cols += x.defs.dbName;
          vals += r.addParameterAndReturnSqlToken(v);
        }
      }
    }


    let statement = `insert into ${this.entity.defs.dbName} (${cols}) values (${vals})`;

    return r.execute(statement).then(() => {
      return this.find({ where: resultFilter }).then(y => {

        return y[0];
      });
    });
  }

}