package com.example.demo;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
public class Main {
  private final List<String> names=new ArrayList<>();
    public static void main(String[] args){
        Main app=new Main();
      for(String arg:args){app.add(arg);}
        System.out.println(app.describe("Total number of names collected from the command line arguments", app.names.size(), true));
    }
  void add(String name){if(name!=null&&!name.isEmpty()){names.add(name.trim());}}
    String describe(String label,int count,boolean verbose){return verbose?label+": "+count+" "+names:label+": "+count;}
    enum Level{LOW,MEDIUM,HIGH}
}
