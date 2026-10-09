package demo
import java.util.Locale
data class Person(val name:String,val age:Int)
class Greeter(private val greeting:String="Hello"){
    fun greet(person:Person,shout:Boolean=false):String{
        val message="$greeting, ${person.name}!"
        return if(shout) message.uppercase(Locale.ROOT) else message
    }
}
fun main(args:Array<String>){
    val people=listOf(Person("Ada",36),Person("Linus",54))
    people.filter{it.age>40}.sortedBy{it.name}.forEach{println(Greeter().greet(it,shout=args.isNotEmpty()))}
    when(people.size){0->println("nobody");1->println("one person");else->println("${people.size} people")}
}
