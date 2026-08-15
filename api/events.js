const ATL={lat:33.7490,lon:-84.3880};
const timeout=(ms)=>AbortSignal.timeout?AbortSignal.timeout(ms):undefined;
function tmNorm(e){const v=e?._embedded?.venues?.[0]||{};return{source:"Ticketmaster",title:e.name||"Event",start:e.dates?.start?.dateTime||(e.dates?.start?.localDate?`${e.dates.start.localDate}T${e.dates.start.localTime||"19:00:00"}`:null),venue:v.name||"Atlanta",type:e.classifications?.[0]?.segment?.name||"Event"}}
function rapidNorm(e){return{source:"RapidAPI",title:e.name||e.title||e.event_name||"Event",start:e.start_time||e.start||e.date_time||e.datetime||e.date||null,venue:e.venue?.name||e.venue_name||e.venue||e.location?.name||"Atlanta",type:e.type||e.category||"Event"}}
module.exports=async(req,res)=>{
  const date=String(req.query.date||new Date().toISOString().slice(0,10));
  const radius=Math.max(5,Math.min(100,Number(req.query.radius||25)));
  const mode=req.query.mode==="day"?"day":"night";
  const events=[]; const sources={Ticketmaster:"missing",RapidAPI:"missing"};
  const jobs=[];
  if(process.env.TICKETMASTER_KEY){
    jobs.push((async()=>{try{
      const p=new URLSearchParams({apikey:process.env.TICKETMASTER_KEY,latlong:`${ATL.lat},${ATL.lon}`,radius:String(radius),unit:"miles",countryCode:"US",stateCode:"GA",startDateTime:`${date}T00:00:00Z`,endDateTime:`${date}T23:59:59Z`,size:"100",sort:"date,asc"});
      const r=await fetch("https://app.ticketmaster.com/discovery/v2/events.json?"+p,{signal:timeout(9000)});
      if(!r.ok)throw new Error(String(r.status)); const j=await r.json(); (j?._embedded?.events||[]).forEach(x=>events.push(tmNorm(x))); sources.Ticketmaster="ok";
    }catch{sources.Ticketmaster="error"}})());
  }
  if(process.env.RAPIDAPI_KEY){
    jobs.push((async()=>{try{
      const human=new Date(date+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
      const query=mode==="day"?`conventions conferences festivals Atlanta Georgia on ${human}`:`major events concerts sports Atlanta Georgia on ${human}`;
      const u="https://real-time-events-search.p.rapidapi.com/search-events?query="+encodeURIComponent(query)+"&date=any&is_virtual=false&start=0";
      const r=await fetch(u,{headers:{"x-rapidapi-host":"real-time-events-search.p.rapidapi.com","x-rapidapi-key":process.env.RAPIDAPI_KEY},signal:timeout(9000)});
      if(!r.ok)throw new Error(String(r.status)); const j=await r.json(); const a=Array.isArray(j)?j:(j.data||j.events||j.results||[]); a.forEach(x=>events.push(rapidNorm(x))); sources.RapidAPI="ok";
    }catch{sources.RapidAPI="error"}})());
  }
  await Promise.allSettled(jobs);
  const seen=new Set(); const dedup=events.filter(e=>{const k=(e.title+"|"+e.start).toLowerCase();if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>new Date(a.start||0)-new Date(b.start||0));
  res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({events:dedup,sources});
};