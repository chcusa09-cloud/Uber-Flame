const ATL={lat:33.7490,lon:-84.3880};
const timeout=ms=>AbortSignal.timeout?AbortSignal.timeout(ms):undefined;
const sourceError=(source,error)=>console.error(JSON.stringify({level:"error",route:"/api/events",source,error:error instanceof Error?error.message:String(error)}));
const estimatedMinutes=type=>{
  const value=String(type||"").toLowerCase();
  if(/sport/.test(value))return 180;
  if(/music|concert/.test(value))return 165;
  if(/festival|expo|conference/.test(value))return 240;
  if(/perform|arts|comedy/.test(value))return 150;
  return 150;
};
function withTiming(event){
  let end=event.end||null;
  let endEstimated=false;
  if(!end&&event.start){
    const start=new Date(event.start);
    if(!Number.isNaN(start.getTime())){
      end=new Date(start.getTime()+estimatedMinutes(event.type)*60000).toISOString();
      endEstimated=true;
    }
  }
  let pickupTarget=null;
  if(end){
    const endDate=new Date(end);
    if(!Number.isNaN(endDate.getTime()))pickupTarget=new Date(endDate.getTime()-30*60000).toISOString();
  }
  return {...event,end,endEstimated,pickupTarget};
}

function tmNorm(e){
  const v=e?._embedded?.venues?.[0]||{};
  return withTiming({
    source:"Ticketmaster",
    title:e.name||"Event",
    start:e.dates?.start?.dateTime||(e.dates?.start?.localDate?`${e.dates.start.localDate}T${e.dates.start.localTime||"19:00:00"}`:null),
    end:e.dates?.end?.dateTime||(e.dates?.end?.localDate?`${e.dates.end.localDate}T${e.dates.end.localTime||"22:00:00"}`:null),
    venue:v.name||"Atlanta",
    type:e.classifications?.[0]?.segment?.name||"Event",
    rank:0
  });
}

function phqNorm(e){
  const entity=(e.entities||[]).find(x=>x.type==="venue")||(e.entities||[])[0]||{};
  return withTiming({
    source:"PredictHQ",
    title:e.title||"Event",
    start:e.start||null,
    end:e.end||null,
    venue:entity.name||e.location?.[2]||"Atlanta",
    type:e.category||"Event",
    rank:Number(e.local_rank||e.rank||0)
  });
}

function zonedDateTimeToUtc(date,time){
  const wanted=Date.parse(`${date}T${time}Z`);
  let guess=wanted;
  const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  for(let i=0;i<2;i++){
    const parts=Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
    const shown=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
    guess+=wanted-shown;
  }
  return new Date(guess);
}

function nextDate(date){
  const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);
}

function mlbNorm(game){
  const home=game.teams?.home?.team?.name||"Home";
  const away=game.teams?.away?.team?.name||"Away";
  const start=game.gameDate||null;
  return withTiming({source:"MLB",title:`${away} at ${home}`,start,venue:game.venue?.name||"Truist Park",type:"Baseball",rank:100,gameStatus:game.status?.detailedState||"Scheduled",homeAway:home==="Atlanta Braves"?"home":"away",gamePk:game.gamePk||null});
}

module.exports=async(req,res)=>{
  const date=String(req.query.date||new Date().toISOString().slice(0,10));
  const radius=Math.max(5,Math.min(100,Number(req.query.radius||25)));
  const mode=req.query.mode==="day"?"day":"night";
  const events=[];
  const sources={Ticketmaster:"missing",PredictHQ:"missing",MLB:"error"};
  const jobs=[];
  const serviceStart=zonedDateTimeToUtc(date,"04:00:00").toISOString();
  const serviceEnd=zonedDateTimeToUtc(nextDate(date),"03:59:59").toISOString();

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
          startDateTime:serviceStart.replace(".000Z","Z"),
          endDateTime:serviceEnd.replace(".000Z","Z"),
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
          "active.gte":serviceStart,
          "active.lte":serviceEnd,
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

  jobs.push((async()=>{
    try{
      const p=new URLSearchParams({sportId:"1",teamId:"144",startDate:date,endDate:nextDate(date),hydrate:"team,venue,linescore"});
      const r=await fetch("https://statsapi.mlb.com/api/v1/schedule?"+p,{signal:timeout(9000)});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const j=await r.json();
      (j.dates||[]).flatMap(x=>x.games||[]).map(mlbNorm).filter(x=>x.start>=serviceStart&&x.start<=serviceEnd).forEach(x=>events.push(x));
      sources.MLB="ok";
    }catch(error){sources.MLB="error";sourceError("MLB",error);}
  })());

  await Promise.allSettled(jobs);
  const seen=new Set();
  const dedup=events.filter(e=>{
    const k=(e.title+"|"+e.start).toLowerCase();
    if(seen.has(k))return false;
    seen.add(k);
    return true;
  }).sort((a,b)=>new Date(a.pickupTarget||a.start||0)-new Date(b.pickupTarget||b.start||0)||Number(b.rank||0)-Number(a.rank||0));

  res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({events:dedup,sources});
};
