const pending=new Map<string,Promise<unknown>>();let generation=0;
export function invalidatePendingReads(){generation++;pending.clear();}
// Share only work currently running; completed data is never cached.
export async function coalesceRead<T>(key:string,load:()=>Promise<T>):Promise<T>{
 const scoped=generation+':'+key,existing=pending.get(scoped);if(existing)return existing as Promise<T>;
 const value=load();pending.set(scoped,value);
 try{return await value;}finally{if(pending.get(scoped)===value)pending.delete(scoped);}
}
