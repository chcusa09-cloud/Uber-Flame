const ATL={lat:33.7490,lon:-84.3880};
const timeout=ms=>AbortSignal.timeout?AbortSignal.timeout(ms):undefined;
const sourceError=(source,error)=>console.error(JSON.stringify({level:"error",route:"/api/events",source,error:error instanceof Error?error.message:String(error)}));

function tmNorm(e){
  const v=e?._embedded?.venues?.[0]||{};
  return {
    source:"Ticketmaster",
    title:e.name||"Event",
    start:e.dates?.start?.dateTime||(e.dates?.start?.localDate?`${e.dates.start.localDate}T${e.dates.start.localTime||"19:00:00"}`:null),
    venue:v.name||"Atlanta",
    type:e.classifications?.[0]?.segment?.name||"Event",
    rank:0
  };
}

function phqNorm(e){
  const entity=(e.entities||[]).find(x=>x.type==="venue")||(e.entities||[])[0]||{};
  return {
    source:"PredictHQ",
    title:e.title||"Event",
    start:e.start||null,
    venue:entity.name||e.location?.[2]||"Atlanta",
    type:e.category||"Event",
    rank:Number(e.local_rank||e.rank||0)
  };
}

module.exports=async(req,res)=>{
  const date=String(req.query.date||new Date().toISOString().slice(0,10));
  const radius=Math.max(5,Math.min(100,Number(req.query.radius||25)));
  const mode=req.query.mode==="day"?"day":"night";
  const events=[];
  const sources={Ticketmaster:"missing",PredictHQ:"missing"};
  const jobs=[];

  if(process.env.TICKETMASTER_KEY){
    jobs.push((async()=>{
      try{
        const p=new URLSearchParams({
          apikey:process.env.TICKETMASTER_KEY,
          latlong:`${ATL.lat},${ATL.lon}`,
          radius:String(radius),
          unit:"miles",
          countryCode:"US",
          stateCode:"GA",
          startDateTime:`${date}T00:00:00Z`,
          endDateTime:`${date}T23:59:59Z`,
          size:"100",
          sort:"date,asc"
        });
        const r=await fetch("https://app.ticketmaster.com/discovery/v2/events.json?"+p,{signal:timeout(9000)});
        if(!r.ok)throw new Error(`HTTP ${r.status}`);
        const j=await r.json();
        (j?._embedded?.events||[]).forEach(x=>events.push(tmNorm(x)));
        sources.Ticketmaster="ok";
      }catch(error){
        sources.Ticketmaster="error";
        sourceError("Ticketmaster",error);
      }
    })());
  }

  if(process.env.PREDICTHQ_TOKEN){
    jobs.push((async()=>{
      try{
        const categories=mode==="day"
          ?"conferences,community,expos,festivals,performing-arts,sports"
          :"concerts,festivals,performing-arts,sports";
        const p=new URLSearchParams({
          "active.gte":`${date}T00:00:00Z`,
          "active.lte":`${date}T23:59:59Z`,
          within:`${radius}mi@${ATL.lat},${ATL.lon}`,
          category:categories,
          limit:"100",
          sort:"rank"
        });
        const r=await fetch("https://api.predicthq.com/v1/events/?"+p,{
          headers:{Authorization:`Bearer ${process.env.PREDICTHQ_TOKEN}`,Accept:"application/json"},
          signal:timeout(9000)
        });
        if(!r.ok)throw new Error(`HTTP ${r.status}`);
        const j=await r.json();
        (j.results||[]).filter(x=>Number(x.local_rank||x.rank||0)>=25).forEach(x=>events.push(phqNorm(x)));
        sources.PredictHQ="ok";
      }catch(error){
        sources.PredictHQ="error";
        sourceError("PredictHQ",error);
      }
    })());
  }

  await Promise.allSettled(jobs);
  const seen=new Set();
  const dedup=events.filter(e=>{
    const k=(e.title+"|"+e.start).toLowerCase();
    if(seen.has(k))return false;
    seen.add(k);
    return true;
  }).sort((a,b)=>new Date(a.start||0)-new Date(b.start||0)||Number(b.rank||0)-Number(a.rank||0));

  res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({events:dedup,sources});
};
