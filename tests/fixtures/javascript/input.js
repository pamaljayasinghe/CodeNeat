import {readFile,writeFile} from "node:fs/promises"
const DEFAULTS={retries:3,timeout:1000,headers:{"content-type":"application/json",accept:"*/*"}}
export async function loadConfig(path,options={}){
    const settings = {...DEFAULTS,...options}
  const text=await readFile(path,"utf8")
    if(!text) {throw new Error('The configuration file "'+path+'" is empty, so the default settings cannot be merged with it')}
  return Object.entries(JSON.parse(text)).filter(([key,value])=>value!=null&&!key.startsWith("_")).map(([key,value])=>({key,value,source:path}))
}
export const save = async (path,data) => writeFile(path,JSON.stringify(data,null,2))
const pick = value => value ? value.items.map(item=>item.id) : []
