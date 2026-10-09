import {EventEmitter} from "node:events"
export interface User{id:number;name:string;email?:string;roles:Array<"admin"|"editor"|"viewer">}
type Listener<T>=(value:T)=>void
export class UserStore extends EventEmitter{
    private users=new Map<number,User>()
  constructor(private readonly limit:number=100){super()}
    add(user:User):boolean{
      if(this.users.size>=this.limit){return false}
        this.users.set(user.id,user);this.emit("added",user)
      return true}
  find<K extends keyof User>(key:K,value:User[K]):User|undefined{return [...this.users.values()].find(candidate=>candidate[key]===value)}
}
export function describe(user:User,options:{verbose?:boolean,separator?:string}={}):string{const {verbose=false,separator=", "}=options;return verbose?`${user.name} <${user.email??"no email"}> (${user.roles.join(separator)})`:user.name}
const noop:Listener<unknown> = value => {}
