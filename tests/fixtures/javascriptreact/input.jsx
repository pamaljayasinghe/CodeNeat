import React,{useState} from "react"
export function Counter({initial=0,label,onChange}){
  const [count,setCount]=useState(initial)
  const update=delta=>{const next=count+delta;setCount(next);onChange&&onChange(next)}
  return <div className="counter" data-count={count}><span className='label'>{label}: {count}</span>
    <button type="button" disabled={count<=0} onClick={()=>update(-1)} aria-label="Decrease the counter by one">-</button><button type="button" onClick={()=>update(1)}>+</button>
    {count>10?<p className="warning">That is a lot!</p>:null}</div>
}
