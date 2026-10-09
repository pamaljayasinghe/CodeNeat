#include <stdio.h>
#include <stdlib.h>
#include "util.h"
typedef struct {int x;int y;} point_t;
static int distance_squared(const point_t *a,const point_t *b){int dx=a->x-b->x;int dy=a->y-b->y;return dx*dx+dy*dy;}
int main(int argc,char **argv){
  point_t origin={0,0};point_t p={3,4};
    if(argc>1){p.x=atoi(argv[1]);}
  switch(distance_squared(&origin,&p)){case 0:printf("same point\n");break;case 25:printf("classic triangle\n");break;default:printf("distance squared between the two points is %d\n",distance_squared(&origin,&p));}
  for(int i=0;i<3;i++) printf("%d\n",i);
  return 0;}
