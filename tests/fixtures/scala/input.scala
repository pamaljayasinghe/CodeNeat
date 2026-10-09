package demo
import scala.collection.mutable
case class Person(name:String,age:Int)
object Main{
  def describe(person:Person,verbose:Boolean=false):String=if(verbose) s"${person.name} is ${person.age} years old" else person.name
  def main(args:Array[String]):Unit={
    val people=List(Person("Ada",36),Person("Linus",54))
    val index=mutable.Map.empty[String,Int]
    people.filter(_.age>=18).foreach{p=>index(p.name)=p.age}
    people.map(describe(_,verbose=args.nonEmpty)).foreach(println)
    index.get("Ada") match{case Some(age)=>println(s"Ada is $age");case None=>println("unknown")}
  }
}
