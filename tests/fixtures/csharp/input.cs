using System;
using System.Collections.Generic;
using System.Linq;
namespace Demo{
public record Person(string Name,int Age);
public class Program{
static readonly List<Person> People=new(){new("Ada",36),new("Linus",54),new("Grace",85)};
public static void Main(string[] args){
var adults=People.Where(p=>p.Age>=18).OrderBy(p=>p.Name).Select(p=>$"{p.Name} ({p.Age})").ToList();
if(adults.Count==0){Console.WriteLine("nobody");return;}
foreach(var line in adults){Console.WriteLine(line);}
}
static int Add(int a,int b)=>a+b;
}}
