
import { DataProvider, FindOptions as FindOptions, EntityDataProvider, EntityDataProviderFindOptions, EntityProvider, EntityOrderBy, EntityWhere, entityOrderByToSort, extractSort } from "./data-interfaces";



import { InMemoryDataProvider } from "./data-providers/in-memory-database";
import { DataApiRequest, DataApiSettings } from "./data-api";
import { isFunction, isString, isBoolean } from "util";

import { Column } from "./column";
import { Entity } from "./entity";
import { Lookup } from "./lookup";
import { IDataSettings, GridSettings } from "./grid-settings";

import { FilterBase } from './filter/filter-interfaces';
import { Action } from './server-action';
import { ValueListItem } from './column-interfaces';
import { Sort } from './sort';
import { RestDataProvider, RestDataProviderHttpProviderUsingFetch } from './data-providers/rest-data-provider';






export class Context {
    clearAllCache(): any {
        this.cache.clear();
        this._lookupCache = [];
    }

    isSignedIn() {
        return !!this.user;
    }
    constructor() {
        this._dataSource = new RestDataProvider(Context.apiBaseUrl, new RestDataProviderHttpProviderUsingFetch());
    }

    getCookie(name: string) {
        return '';
    }
    getHost() {
        return '';
    }
    getPathInUrl() {
        return window.location.pathname;
    }


    _dataSource: DataProvider;
    setDataProvider(dataProvider: DataProvider) {
        this._dataSource = dataProvider;
    }
    protected _onServer = false;
    get onServer(): boolean {
        return this._onServer;
    }
    protected _user: UserInfo;
    get user() { return this._user; }

    _setUser(info: UserInfo) {
        this._user = info;
    }
    static apiBaseUrl = 'api';

    isAllowed(roles: Allowed) {
        if (roles == undefined)
            return undefined;
        if (roles instanceof Array) {
            for (const role of roles) {
                if (this.isAllowed(role) === true) {
                    return true;
                }
            }
            return false;
        }

        if (isFunction(roles)) {
            return (<any>roles)(this);
        }
        if (isBoolean(roles))
            return roles;

        if (roles instanceof Role) {
            roles = roles.key;
        }
        if (!this.user)
            return false;
        if (isString(roles))
            if (this.user.roles.indexOf(roles.toString()) >= 0)
                return true;


        return false;
    }

    cache = new Map<DataProvider, Map<any, SpecificEntityHelper<any, Entity>>>();
    public for<lookupIdType, T extends Entity<lookupIdType>>(c: { new(...args: any[]): T; }, dataSource?: DataProvider) {
        if (!dataSource)
            dataSource = this._dataSource;

        let dsCache = this.cache.get(dataSource);
        if (!dsCache) {
            dsCache = new Map<string, SpecificEntityHelper<any, Entity>>();
            this.cache.set(dataSource, dsCache);
        }


        let r = dsCache.get(c) as SpecificEntityHelper<lookupIdType, T>;
        if (!r) {
            r = new SpecificEntityHelper<lookupIdType, T>(() => {
                let e = new c(this);
                e.__initColumns((<any>e).id);

                return e;
            }, this._lookupCache, this, dataSource);
            dsCache.set(c, r);
        }



        return r;
    }
    _dialog: any;//MatDialog
    async openDialog<T, C>(component: { new(...args: any[]): C; }, setParameters?: (it: C) => void, returnAValue?: (it: C) => T): Promise<T> {

        throw "requires specific implementation for this environment";
    }

    _lookupCache: LookupCache<any>[] = [];
}
export declare type DataProviderFactoryBuilder = (req: Context) => DataProvider;
export class ServerContext extends Context {
    constructor(dp?: DataProvider) {
        super();
        this._onServer = true;
        if (dp)
            this.setDataProvider(dp);


    }
    getHost() {
        if (!this.req)
            return undefined;
        return this.req.getHeader('host');
    }
    getPathInUrl() {
        if (!this.req)
            return undefined;
        return this.req.getBaseUrl();
    }
    getCookie(name: string) {
        if (this.req) {
            let cookie = this.req.getHeader('cookie');
            if (cookie)
                for (const iterator of cookie.split(';')) {
                    let itemInfo = iterator.split('=');
                    if (itemInfo && itemInfo[0].trim() == name) {
                        return itemInfo[1];
                    }
                }
        }
        return undefined;
    }
    private req: DataApiRequest;

    setReq(req: DataApiRequest) {
        this.req = req;
        this._user = req.user ? req.user : undefined;
    }

    getOrigin() {
        if (!this.req)
            return undefined;
        return this.req.getHeader('origin')
    }
}


export class SpecificEntityHelper<lookupIdType, T extends Entity<lookupIdType>> implements EntityProvider<T>{
    _getApiSettings(): DataApiSettings<T> {
        return this.entity._getEntityApiSettings(this.context);
    }

    private entity: T;
    private _edp: EntityDataProvider;
    private _factory: (newRow: boolean) => T;
    constructor(
        /** Creates a new instance of the entity
         * @example
         * let p = this.context.for(Products).create();
         * p.name.value = 'Wine';
         * await p.save();
         */
        public create: () => T
        , private _lookupCache: LookupCache<any>[], private context: Context, dataSource: DataProvider) {
        this._factory = newRow => {
            let e = create();
            e.__entityData.dataProvider = this._edp;
            if (this.context.onServer)
                e.__entityData.initServerExpressions = async () => {
                    await Promise.all(e.columns.toArray().map(async c => {
                        await c.__calcServerExpression();
                    }));
                }
            if (newRow) {
                e.columns.toArray().forEach(c => { c.__setDefaultForNewRow() });
            }
            return e;
        };
        this.create = () => {
            return this._factory(true);
        };
        this.entity = this._factory(false);
        this._edp = dataSource.getEntityDataProvider(this.entity);
    }

    /** Returns an array of rows for the specific type 
    * @example
    * let products = await context.for(Products).find();
    * for (const p of products) {
    *   console.log(p.name.value);
    * }
    * @example
    * this.products = await this.context.for(Products).find({
    *     orderBy: p => p.name
    *     , where: p => p.availableFrom.isLessOrEqualTo(new Date()).and(
    *     p.availableTo.isGreaterOrEqualTo(new Date()))
    * });
    * @see
    * For all the different options see [FindOptions](ref_findoptions)
    */
    async find(options?: FindOptions<T>) {
        let r = await this._edp.find(this.translateOptions(options));
        return Promise.all(r.map(async i => {
            let r = this._factory(false);
            await r.__entityData.setData(i, r);
            return r;
        }));
    }
    /** returns a single entity based on a filter
     * @example:
     * let p = await this.context.for(Products).findFirst(p => p.id.isEqualTo(7))
     */
    async findFirst(options?: EntityWhere<T> | IterateOptions<T>) {
        return this.iterate(options).first();
    }
    /** returns a single entity based on it's id 
     * @example
     * let p = await context.for(Products).findId(productId);
    */
    async findId(id: Column<lookupIdType> | lookupIdType) {
        return this.iterate(x => x.columns.idColumn.isEqualTo(id)).first();
    }

    /**
     * Used to get non critical values from the Entity.
    * The first time this method is called, it'll return a new instance of the Entity.
    * It'll them call the server to get the actual value and cache it.
    * Once the value is back from the server, any following call to this method will return the cached row.
    * 
    * It was designed for displaying a value from a lookup table on the ui - counting on the fact that it'll be called multiple times and eventually return the correct value.
    * 
    * * Note that this method is not called with `await` since it doesn't wait for the value to be fetched from the server.
    * @example
    * return  context.for(Products).lookup(p=>p.id.isEqualTo(productId));
     */
    lookup(filter: Column<lookupIdType> | EntityWhere<T>): T {

        let key = this.entity.defs.name;
        let lookup: Lookup<lookupIdType, T>;
        this._lookupCache.forEach(l => {
            if (l.key == key)
                lookup = l.lookup;
        });
        if (!lookup) {
            lookup = new Lookup(this.entity, this);
            this._lookupCache.push({ key, lookup });
        }
        return lookup.get(filter);

    }
    /** returns a single row and caches the result for each future call
     * @example
     * let p = await this.context.for(Products).lookupAsync(p => p.id.isEqualTo(productId));
     */
    lookupAsync(filter: Column<lookupIdType> | EntityWhere<T>): Promise<T> {

        let key = this.entity.defs.name;
        let lookup: Lookup<lookupIdType, T>;
        this._lookupCache.forEach(l => {
            if (l.key == key)
                lookup = l.lookup;
        });
        if (!lookup) {
            lookup = new Lookup(this.entity, this);
            this._lookupCache.push({ key, lookup });
        }
        return lookup.whenGet(filter);

    }

    /** returns the number of rows that matches the condition 
     * @example
     * let count = await this.context.for(Products).count(p => p.price.isGreaterOrEqualTo(5))
    */
    async count(where?: EntityWhere<T>) {
        return await this._edp.count(this.entity.__decorateWhere(where ? where(this.entity) : undefined));
    }



    private translateOptions(options: FindOptions<T>) {

        let getOptions: EntityDataProviderFindOptions = {};
        if (!options) {
            options = {};
        }
        if (options.where)
            getOptions.where = options.where(this.entity);
        if (options.orderBy)
            getOptions.orderBy = entityOrderByToSort(this.entity, options.orderBy);
        else if (this.entity.__options.defaultOrderBy)
            getOptions.orderBy = extractSort(this.entity.__options.defaultOrderBy());
        if (options.limit)
            getOptions.limit = options.limit;
        if (options.page)
            getOptions.page = options.page;
        if (options.__customFindData)
            getOptions.__customFindData = options.__customFindData;
        getOptions.where = this.entity.__decorateWhere(getOptions.where);
        return getOptions;
    }


    /** Iterate is a more robust version of Find, that is designed to iterate over a large dataset without loading all the data into an array
     * It's safer to use Iterate when working with large datasets of data.
     * 
     * 
     * @example
     * for await (let p of this.context.for(Products).iterate()){
     *   console.log(p.name.value);
     * }
     * @example
     * for await (let p of this.context.for(Products).iterate({
     *     orderBy: p => p.name
     *     , where: p => p.availableFrom.isLessOrEqualTo(new Date()).and(
     *     p.availableTo.isGreaterOrEqualTo(new Date()))
        })){
     *   console.log(p.name.value);
     * }
    */

    iterate(options?: EntityWhere<T> | IterateOptions<T>) {

        let opts: IterateOptions<T> = {};
        if (options) {
            if (isFunction(options))
                opts.where = <any>options;
            else
                opts = <any>options;
        }

        let cont = this;
        let _count: number;
        let r = new class {

            async toArray(options?: IterateToArrayOptions) {
                if (!options) {
                    options = {};
                }


                return cont.find({
                    where: opts.where,
                    orderBy: opts.orderBy,
                    limit: options.limit,
                    page: options.page
                });
            }
            async first() {
                let r = await cont.find({
                    where: opts.where,
                    orderBy: opts.orderBy,
                    limit: 1
                });
                if (r.length == 0)
                    return undefined;
                return r[0];
            }

            async count() {
                if (_count === undefined)
                    _count = await cont.count(opts.where);
                return _count;

            }
            async forEach(what: (item: T) => Promise<any>) {
                let i = 0;
                for await (const x of this) {
                    await what(x);
                    i++;
                }
                return i;
            }

            //@ts-ignore
            [Symbol.asyncIterator]() {
                let findOptions: FindOptions<T> = {};
                if (opts.where) {
                    findOptions.where = opts.where;
                }



                let pageIndex: number;
                let pageSize = iterateConfig.pageSize;
                findOptions.limit = pageSize;

                let itemIndex = -1;
                let items: T[];

                let itStrategy: (() => Promise<IteratorResult<T>>);

                itStrategy = async () => {
                    items = await cont.find({
                        where: opts.where,
                        orderBy: opts.orderBy,
                        limit: pageSize
                    });
                    if (items.length < pageSize) {
                        _count = items.length;
                        itemIndex = 0;
                        itStrategy = async () => {

                            if (itemIndex >= items.length)
                                return { value: <T>undefined, done: true };
                            return { value: items[itemIndex++], done: false };
                        };
                    }
                    else {
                        if (!opts.orderBy)
                            if (cont.entity.__options.defaultOrderBy)
                                opts.orderBy = cont.entity.__options.defaultOrderBy;
                            else
                                opts.orderBy = x => x.columns.idColumn;

                        let sort = extractSort(opts.orderBy(cont.entity)).reverse();

                        findOptions.orderBy = x => sort;
                        pageIndex = Math.ceil(await this.count() / pageSize);
                        itStrategy = async () => {
                            while (itemIndex < 0) {
                                if (pageIndex < 1) {
                                    return { value: undefined, done: true };
                                }
                                findOptions.page = pageIndex--;
                                items = await cont.find(findOptions);
                                itemIndex = items.length - 1;
                            }
                            return { value: items[itemIndex--], done: false };
                        }
                    }
                    return itStrategy();
                };
                return {
                    next: async () => {
                        let r = itStrategy();
                        return r;
                    }
                };
            }
        }
        return r;
    }
    /** Creates an instance of an entity based on a JSON object */
    async fromPojo(r: any) {
        let f = this._factory(false);
        await f.__entityData.setData(r, f);
        return f;
    }
    /** Creates a JSON object based on an entity */
    toApiPojo(entity: T): any {
        let r = {};
        for (const c of entity.columns) {

            c.__addToPojo(r, this.context)
        }
        return r;

    }
    _updateEntityBasedOnApi(entity: T, body: any) {
        for (const c of entity.columns) {

            c.__loadFromPojo(body, this.context);
        }
        return entity;
    }

    /** creates an array of JSON objects based on an array of Entities  */
    toPojoArray(items: T[]) {
        return items.map(f => this.toApiPojo(f));
    }
    /** returns a grid settings object for the specific entity */
    gridSettings(settings?: IDataSettings<T>) {
        if (!settings)
            settings = {};
        return new GridSettings(this, this.context, settings);
    }

    /** returns an array of values that can be used in the value list property of a data control object */

    async getValueList(args?: {
        idColumn?: (e: T) => Column,
        captionColumn?: (e: T) => Column,
        orderBy?: EntityOrderBy<T>,
        where?: EntityWhere<T>
    }): Promise<ValueListItem[]> {
        if (!args) {
            args = {};
        }
        if (!args.idColumn) {
            args.idColumn = x => x.columns.idColumn;
        }
        if (!args.captionColumn) {
            let idCol = args.idColumn(this.entity);
            for (const keyInItem of this.entity.columns) {
                if (keyInItem != idCol) {
                    args.captionColumn = x => x.columns.find(keyInItem);
                    break;
                }
            }
        }
        return (await this.find({
            where: args.where,
            orderBy: args.orderBy,
            limit: 1000
        })).map(x => {
            return {
                id: args.idColumn(x).value,
                caption: args.captionColumn(x).value
            }
        });
    }
}
export interface EntityType<T> {
    new(...args: any[]): Entity<T>;
}
export const allEntities: EntityType<any>[] = [];
export interface ControllerOptions {
    key: string,
    allowed: Allowed

}

export const classHelpers = new Map<any, ClassHelper>();
export class ClassHelper {
    methods: MethodHelper[] = [];
}
export class MethodHelper {
    classes = new Map<any, ControllerOptions>();
}
export function setControllerSettings(target:any,options:ControllerOptions){
    let r = target;
    while (true) {
        let helper = classHelpers.get(r);
        if (helper) {
            for (const m of helper.methods) {
                m.classes.set(target, options);
            }
        }
        let p = Object.getPrototypeOf(r.prototype);
        if (p == null)
            break;
        r = p.constructor;
    }
}

export function EntityClass<T extends EntityType<any>>(theEntityClass: T) {
    let original = theEntityClass;
    let f = original;
    setControllerSettings(theEntityClass,{allowed:false,key:undefined})
    /*f = class extends theEntityClass {
        constructor(...args: any[]) {
            super(...args);
            this.__initColumns((<any>this).id);
            if (!this.__options.name) {
                this.__options.name = original.name;
            }
        }
    }*/
    allEntities.push(f);
    return f;
}
export interface UserInfo {
    id: string;
    name: string;
    roles: string[];
}


// @dynamic
export class Role {
    constructor(public key: string) {

    }
    static not(allowed: Allowed): Allowed {
        return c => !c.isAllowed(allowed);
    }
}
declare type AllowedRule = string | Role | ((c: Context) => boolean) | boolean;;
export declare type Allowed = AllowedRule | AllowedRule[];
export declare type AngularComponent = { new(...args: any[]): any };






interface LookupCache<T extends Entity> {
    key: string;
    lookup: Lookup<any, T>;
}
export interface RoleChecker {
    isAllowed(roles: Allowed): boolean;
}
export interface IterateOptions<entityType extends Entity> {
    where?: EntityWhere<entityType>;
    orderBy?: EntityOrderBy<entityType>;
}


export interface IterateToArrayOptions {
    limit?: number;
    page?: number;
}
export const iterateConfig = {
    pageSize: 200
};