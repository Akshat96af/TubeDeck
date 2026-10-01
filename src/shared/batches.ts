/** Keep every record intact. An unusually long single record forms its own batch. */
export function batches<T>(items:T[],size:(item:T)=>number,limit=50000):T[][]{
  const result:T[][]=[];let group:T[]=[],length=0;
  for(const item of items){const n=size(item);if(group.length&&length+n>limit){result.push(group);group=[];length=0;}group.push(item);length+=n;}
  if(group.length)result.push(group);return result;
}
