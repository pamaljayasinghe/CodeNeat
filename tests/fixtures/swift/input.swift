import Foundation
struct Person{let name:String
var age:Int}
enum GreetingError:Error{case emptyName}
final class Greeter{
private let greeting:String
init(greeting:String="Hello"){self.greeting=greeting}
func greet(_ person:Person,shout:Bool=false)throws->String{
guard !person.name.isEmpty else{throw GreetingError.emptyName}
let message="\(greeting), \(person.name)!"
return shout ? message.uppercased():message}
}
let people=[Person(name:"Ada",age:36),Person(name:"Linus",age:54)]
for person in people where person.age>40{print((try? Greeter().greet(person,shout:true)) ?? "The greeting could not be created for this person")}
