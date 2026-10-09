#include <vector>
#include <string>
#include <algorithm>
#include <iostream>
namespace demo{
template<typename T> class Stack{public:
  void push(const T& value){items_.push_back(value);}
  T pop(){T value=items_.back();items_.pop_back();return value;}
  bool empty() const{return items_.empty();}
private:std::vector<T> items_;};
}
int main(int argc,char** argv){
  demo::Stack<std::string> stack;
  for(int i=1;i<argc;++i){stack.push(argv[i]);}
  std::vector<int> numbers{5,3,9,1};std::sort(numbers.begin(),numbers.end(),[](int a,int b){return a>b;});
  while(!stack.empty()) std::cout<<stack.pop()<<" has been removed from the stack of command line arguments"<<std::endl;
  return 0;}
