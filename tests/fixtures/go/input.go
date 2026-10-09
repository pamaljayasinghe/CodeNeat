package main
import ("fmt"
"os"
"strings")
type Person struct{Name string
Age int}
func describe(p Person,verbose bool) string{
if verbose{return fmt.Sprintf("%s is %d years old",p.Name,p.Age)}
    return p.Name}
func main(){
people:=[]Person{{"Ada",36},{"Linus",54}}
for _,p:=range people{fmt.Println(strings.ToUpper(describe(p,len(os.Args)>1)))}
}
