use std::fmt;
use std::collections::HashMap;
#[derive(Debug,Clone)]
struct Person{name:String,age:u32}
impl fmt::Display for Person{fn fmt(&self,f:&mut fmt::Formatter)->fmt::Result{write!(f,"{} ({})",self.name,self.age)}}
fn index(people:&[Person])->HashMap<String,u32>{people.iter().filter(|p|p.age>=18).map(|p|(p.name.clone(),p.age)).collect()}
fn main(){
let people=vec![Person{name:"Ada".to_string(),age:36},Person{name:"Linus".to_string(),age:54}];
    for person in &people{println!("{}",person);}
  match index(&people).get("Ada"){Some(age)=>println!("Ada is {} years old according to the index that was just built",age),None=>println!("unknown")}
}
