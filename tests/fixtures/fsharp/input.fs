module Demo
open System
type Person={Name:string;Age:int}
let people=[{Name="Ada";Age=36};{Name="Linus";Age=54};{Name="Grace";Age=85}]
let describe person=sprintf "%s (%d)" person.Name person.Age
let adults=people|>List.filter(fun p->p.Age>=18)|>List.sortBy(fun p->p.Name)|>List.map describe
[<EntryPoint>]
let main argv=
    if List.isEmpty adults then printfn "nobody" else adults|>List.iter(printfn "%s")
    0
