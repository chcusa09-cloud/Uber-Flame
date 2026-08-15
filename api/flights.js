function aeroTimeValue(value){
  if(!value)return null;
  if(typeof value==="string")return value;
  return value.utc||value.local||value.timeUtc||value.timeLocal||null;
}
function scheduledTime(movement){
  return aeroTimeValue(movement?.scheduledTime)||aeroTimeValue(movement?.revisedTime)||aeroTimeValue(movement?.predictedTime)||aeroTimeValue(movement?.actualTime)||null;
}
function revisedTime(movement){
  return aeroTimeValue(movement?.actualTime)||aeroTimeValue(movement?.revisedTime)||aeroTimeValue(movement?.predictedTime)||null;
}
function normalizeFlight(f,direction){
  const movement=direction==="arrival"?(f.arrival||{}):(f.departure||{});
  const scheduled=scheduledTime(movement);
  const revised=revisedTime(movement);
  let delay=0;
  if(scheduled&&revised){
    const a=new Date(scheduled),b=new Date(revised);
    if(!Number.isNaN(a.getTime())&&!Number.isNaN(b.getTime()))delay=Math.max(0,(b-a)/1000);
  }
  const status=String(f.status||movement.status||"Scheduled");
  const cancelled=Boolean(f.cancelled||movement.cancelled||/cancel/i.test(status));
  const airline=f.airline?.name||f.airline?.iata||f.airline?.icao||"";
  const number=f.number||f.flightNumber||f.callSign||"";
  return {
    ident:[airline,number].filter(Boolean).join(" ")||"Flight",
    origin:f.departure?.airport?.iata||f.departure?.airport?.icao||f.departure?.airport?.name||"—",
    destination:f.arrival?.airport?.iata||f.arrival?.airport?.icao||f.arrival?.airport?.name||"—",
    scheduled,cancelled,delay,status,direction
  };
}
module.exports=async(req,res)=>{
  const rapidKey=process.env.RAPIDAPI_KEY||process.env.AERODATABOX_KEY;
  const sources={AeroDataBox:rapidKey?"error":"missing"};
  if(!rapidKey)return res.status(200).json({flights:[],sources});
  try{
    const params=new URLSearchParams({offsetMinutes:"-120",durationMinutes:"720",withLeg:"true",direction:"Both",withCancelled:"true",withCodeshared:"true",withCargo:"false",withPrivate:"false",withLocation:"false"});
    const url="https://aerodatabox.p.rapidapi.com/flights/airports/iata/ATL?"+params;
    const r=await fetch(url,{headers:{"x-rapidapi-host":"aerodatabox.p.rapidapi.com","x-rapidapi-key":rapidKey}});
    if(!r.ok){
      sources.AeroDataBox=r.status===401||r.status===403?"auth_error":r.status===429?"rate_limited":"error";
      throw new Error(`HTTP ${r.status}`);
    }
    const j=await r.json();
    const arrivals=Array.isArray(j.arrivals)?j.arrivals:[];
    const departures=Array.isArray(j.departures)?j.departures:[];
    const flights=[
      ...arrivals.map(f=>normalizeFlight(f,"arrival")),
      ...departures.map(f=>normalizeFlight(f,"departure"))
    ].filter(f=>f.cancelled||f.delay>=1800);
    sources.AeroDataBox="ok";
    res.setHeader("Cache-Control","s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({flights,sources});
  }catch(error){
    console.error(JSON.stringify({level:"error",route:"/api/flights",source:"AeroDataBox",status:sources.AeroDataBox,error:error instanceof Error?error.message:String(error)}));
    return res.status(200).json({flights:[],sources});
  }
};
