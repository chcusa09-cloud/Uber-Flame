const ATL={lat:33.7490,lon:-84.3880};
const timeout=ms=>AbortSignal.timeout?AbortSignal.timeout(ms):undefined;

function busyValue(v){
  const values=[
    v?.venue_foot_traffic_live?.busyness,
    v?.venue_foot_traffic_live?.busyness_percentage,
    v?.venue_foot_traffic_live?.live_busyness,
    v?.day_raw?.[0],
    v?.analysis?.day_raw?.[0]
  ];
  for(const value of values){
    const n=Number(value);
    if(Number.isFinite(n))return n;
  }
  return null;
}

function addressValue(v){
  const value=v.venue_address||v.address||v.venue_info?.venue_address;
  if(typeof value==="string"&&value.trim())return value;
  if(value&&typeof value==="object"){
    const text=[value.street,value.city,value.state,value.postal_code].filter(Boolean).join(", ");
    if(text)return text;
  }
  return "Atlanta";
}

function normalize(v){
  const busy=busyValue(v);
  const type=v.venue_type||v.type||v.venue_info?.venue_type||"Venue";
  const rating=Number(v.rating||v.venue_info?.rating||0);
  const reviews=Number(v.reviews||v.venue_info?.reviews||0);
  const live=Boolean(v.venue_foot_traffic_live)||v.live===true||v.popularity_is_live===true||(Array.isArray(v.day_raw)&&v.day_raw.length===1);
  let score=busy===null?0:busy;
  if(live)score+=8;
  if(/CLUB|BAR|CONCERT|EVENT|STADIUM|RESTAURANT/i.test(String(type)))score+=4;
  if(rating>=4)score+=2;
  if(reviews>=500)score+=2;
  return {
    name:v.venue_name||v.name||v.venue_info?.venue_name||"Venue",
    address:addressValue(v),
    type,
    busy,
    live,
    rating,
    reviews,
    score
  };
}

module.exports=async(req,res)=>{
  const mode=req.query.mode==="day"?"day":"night";
  const radiusMiles=Math.max(5,Math.min(50,Number(req.query.radius||25)));
  const sources={BestTime:process.env.BESTTIME_PRIVATE_KEY?"error":"missing"};
  if(!process.env.BESTTIME_PRIVATE_KEY)return res.status(200).json({venues:[],sources});

  try{
    const types=mode==="day"
      ?"AUDITORIUM,CONCERT_HALL,EVENT_VENUE,FAIRGROUNDS,MUSEUM,PARK,PERFORMING_ARTS,RESTAURANT,SHOPPING_CENTER,SPORTS_COMPLEX,STADIUM"
      :"BAR,CLUBS,CONCERT_HALL,EVENT_VENUE,RESTAURANT,STADIUM";
    const p=new URLSearchParams({
      api_key_private:process.env.BESTTIME_PRIVATE_KEY,
      busy_min:"55",
      busy_max:"100",
      types,
      lat:String(ATL.lat),
      lng:String(ATL.lon),
      radius:String(Math.round(radiusMiles*1609.344)),
      live:"true",
      own_venues_only:"false",
      foot_traffic:"both",
      limit:"30",
      page:"0",
      order_by:"now,reviews",
      order:"desc,desc"
    });
    const r=await fetch("https://besttime.app/api/v1/venues/filter?"+p,{signal:timeout(10000)});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const j=await r.json();
    if(j.status&&String(j.status).toLowerCase()==="error")throw new Error("Provider returned error status");
    const venues=(Array.isArray(j?.venues)?j.venues:[])
      .map(normalize)
      .filter(x=>x.busy!==null)
      .sort((a,b)=>b.score-a.score)
      .slice(0,30);
    sources.BestTime="ok";
    res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({venues,sources});
  }catch(error){
    console.error(JSON.stringify({level:"error",route:"/api/besttime",source:"BestTime",error:error instanceof Error?error.message:String(error)}));
    return res.status(200).json({venues:[],sources});
  }
};
