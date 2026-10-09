require 'json'
class Greeter
    attr_reader :greeting
  def initialize(greeting="Hello")
        @greeting=greeting
  end
  def greet(name,shout: false)
      message="#{greeting}, #{name}!"
      shout ? message.upcase : message
  end
end
people=[{name: "Ada",age: 36},{name: "Linus",age: 54}]
people.select{|p| p[:age]>40}.each do |person|
puts Greeter.new.greet(person[:name],shout: true)
end
