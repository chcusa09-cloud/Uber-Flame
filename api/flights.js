module.exports=async(req,res)=>{
  const date=String(req.query.date||new Date().toISOString().slice(0,10));
  const sources={AeroDataBox:process.env.AERODATABOX_KEY?"error":"missing"};
  if(!process.env.AERODATABOX_KEY)return res.status(200).json({flights:[],sources});
  try{
    const from=`${date}T00:00`; const to=`${date}T23:59`;
    const url=`https://aerodatabox.p.rapidapi.com/flights/airports/icao/KATL/${encodeURIComponent(from)}/${encodeURIComponent(to)}?withLeg=true&direction=Both&withCancelled=true&withCodeshared=true&withCargo=false&withPrivate=false&withLocation=false`;
    const r=await fetch(url,{headers:{"x-rapidapi-host":"aerodatabox.p.rapidapi.com","x-rapidapi-key":process.env.AERODATABOX_KEY}});
    if(!r.ok){
      sources.AeroDataBox=r.status===401||r.status===403?"auth_error":r.status===429?"rate_limited":"error";
      throw new Error(`HTTP ${r.status}`);
    }
    const j=await r.json();
    const raw=[...(j.arrivals||[]),...(j.departures||[])];
    const flights=raw.filter(x=>/cancel|delay/i.test(String(x.status||""))).map(x=>({
      flight:x.number||x.callSign||x.airline?.name||"ATL flight",
      status:x.status||"Unknown",
      time:new Date(x.movement?.scheduledTime?.utc||x.movement?.scheduledTime?.local||"").toLocaleTimeString([],{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"}),
      route:x.movement?.airport?.name||x.movement?.airport?.iata||"ATL",
      direction:(j.arrivals||[]).includes(x)?"Arrival":"Departure"
    }));
    sources.AeroDataBox="ok";
    res.setHeader("Cache-Control","s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({flights,sources});
  }catch(error){
    console.error(JSON.stringify({level:"error",route:"/api/flights",source:"AeroDataBox",status:sources.AeroDataBox,error:error instanceof Error?error.message:String(error)}));
    return res.status(200).json({flights:[],sources});
  }
};
