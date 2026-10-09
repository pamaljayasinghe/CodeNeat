import React,{useMemo} from "react"
interface Item{id:number;title:string;done:boolean}
type Props={items:Item[];filter?:"all"|"open"|"done";onToggle:(id:number)=>void}
export const TodoList:React.FC<Props>=({items,filter="all",onToggle})=>{
  const visible=useMemo(()=>items.filter(item=>filter==="all"||(filter==="done")===item.done),[items,filter])
  if(visible.length===0){return <p className='empty'>Nothing to do</p>}
  return <ul className="todo-list">{visible.map(item=><li key={item.id} className={item.done?"done":undefined} onClick={()=>onToggle(item.id)}><input type="checkbox" checked={item.done} readOnly/>{item.title}</li>)}</ul>
}
