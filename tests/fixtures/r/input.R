library(stats)
people<-data.frame(name=c("Ada","Linus","Grace"),age=c(36,54,85),stringsAsFactors=FALSE)
describe<-function(df,min_age=18,verbose=FALSE){
adults<-df[df$age>=min_age,]
if(nrow(adults)==0){return("nobody")}
if(verbose){paste0(adults$name," (",adults$age,")",collapse=", ")}else{paste(adults$name,collapse=", ")}
}
for(i in seq_len(nrow(people))){print(describe(people[i,],verbose=TRUE))}
mean_age<-mean(people$age);cat("Mean age:",round(mean_age,1),"\n")
