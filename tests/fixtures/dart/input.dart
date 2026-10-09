import 'dart:math';
class Person{final String name;final int age;
const Person(this.name,this.age);
String describe({bool verbose=false})=>verbose?'$name is $age years old':name;}
void main(List<String> args){
final people=[Person('Ada',36),Person('Linus',54)];
for(final person in people.where((p)=>p.age>=18)){print(person.describe(verbose:args.isNotEmpty));}
final oldest=people.map((p)=>p.age).reduce(max);
if(oldest>50){print('Someone is over fifty');}else{print('Everyone is young');}
}
