import { Column } from './column';
import { Entity } from './entity';
import { Sort, SortSegment } from './sort';
import { FilterBase } from './filter/filter-interfaces';

export interface DataProvider {
  getEntityDataProvider(entity: Entity): EntityDataProvider;
  transaction(action: (dataProvider: DataProvider) => Promise<void>): Promise<void>;
}

export interface EntityDataProvider {
  count(where: FilterBase): Promise<number>;
  find(options?: EntityDataProviderFindOptions): Promise<Array<any>>;
  update(id: any, data: any): Promise<any>;
  delete(id: any): Promise<void>;
  insert(data: any): Promise<any>;
}
export interface EntityDataProviderFindOptions {
  where?: FilterBase;
  limit?: number;
  page?: number;
  orderBy?: Sort;
  __customFindData?: any;
}

export interface EntityProvider<T extends Entity> {
  find(options?: FindOptions<T>): Promise<T[]>
  count(where?: EntityWhere<T>): Promise<number>;
  create(): T;

}

/**Used to filter the desired result set
 * @example
 * where: p=> p.availableFrom.isLessOrEqualTo(new Date()).and(p.availableTo.isGreaterOrEqualTo(new Date()))
 */
export declare type EntityWhere<entityType extends Entity> = (entityType: entityType) => FilterBase;
/** Determines the order of rows returned by the query.
 * @example
 * await this.context.for(Products).find({ orderBy: p => p.name })
 * @example
 * await this.context.for(Products).find({ orderBy: p => [p.price, p.name])
 * @example
 * await this.context.for(Products).find({ orderBy: p => [{ column: p.price, descending: true }, p.name])
 */
export declare type EntityOrderBy<entityType extends Entity> = ((entityType: entityType) => Sort) | ((entityType: entityType) => (Column)) | ((entityType: entityType) => (Column | SortSegment)[]);

export function entityOrderByToSort<T2, T extends Entity<T2>>(entity: T, orderBy: EntityOrderBy<T>): Sort {
  return extractSort(orderBy(entity));

}
export function extractSort(sort: any): Sort {

  if (sort instanceof Sort)
    return sort;
  if (sort instanceof Column)
    return new Sort({ column: sort });
  if (sort instanceof Array) {
    let r = new Sort();
    sort.forEach(i => {
      if (i instanceof Column)
        r.Segments.push({ column: i });
      else r.Segments.push(i);
    });
    return r;
  }
}

export interface FindOptions<entityType extends Entity> {
  /** filters the data
   * @example
   * where p => p.price.isGreaterOrEqualTo(5)
   * @see For more usage examples see [EntityWhere](https://remult-ts.github.io/guide/ref_entitywhere)
   */
  where?: EntityWhere<entityType>;
  /** Determines the order in which the result will be sorted in
   * @see See [EntityOrderBy](https://remult-ts.github.io/guide/ref__entityorderby) for more examples on how to sort
   */
  orderBy?: EntityOrderBy<entityType>;
  /** Determines the number of rows returned by the request, on the browser the default is 25 rows 
   * @example
   * this.products = await this.context.for(Products).find({
   *  limit:10,
   *  page:2
   * })
  */
  limit?: number;
  /** Determines the page number that will be used to extract the data 
   * @example
   * this.products = await this.context.for(Products).find({
   *  limit:10,
   *  page:2
   * })
  */
  page?: number;
  __customFindData?: any;
}


export interface __RowsOfDataForTesting {
  rows: any;
}
