<?php
namespace App\Demo;
use InvalidArgumentException;
use App\Models\User;
class Greeter{
    private $greeting;
    function __construct($greeting="Hello"){$this->greeting=$greeting;}
    public function greet(User $user,$shout=false){
        if(!$user->name){throw new InvalidArgumentException("The user needs a name");}
        $message=$this->greeting.", ".$user->name."!";
        return $shout?strtoupper($message):$message;
    }
}
$greeter=new Greeter();
foreach([1,2,3] as $n){echo $n,"\n";}
