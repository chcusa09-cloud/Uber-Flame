const ATL={lat:33.7490,lon:-84.3880};
const timeout=ms=>AbortSignal.timeout?AbortSignal.timeout(ms):undefined;

function addressValue(place){
  const location=place?.location||{};
  return location.formatted_address||
    [location.address,location.locality,location.region].filter(Boolean).join(", ")||
    "Atlanta";
}

function normalize(place,index){
  const category=place?.categories?.[0]?.short_name||place?.categories?.[0]?.name||"Venue";
  const distanceMeters=Number(place?.distance||0);
  const nightlifeBoost=/bar|club|music|concert|stadium|entertainment/i.test(category)?4:0;
  const score=Math.max(55,Math.min(99,96-(index*2)-Math.floor(distanceMeters/8000)+nightlifeBoost));
  return {
    id:place.fsq_place_id||place.fsq_id||"",
    name:place.name||"Venue",
    address:addressValue(place),
    type:category,
    score,
    distanceMiles:Number((distanceMeters/1609.344).toFixed(1)),
    signal:"Popularity-ranked demand estimate"
  };
}

module.exports=async(req,res)=>{
  const mode=req.query.mode==="day"?"day":"night";
  const radiusMiles=Math.max(5,Math.min(50,Number(req.query.radius||25)));
  const key=process.env.FOURSQUARE_API_KEY;
  const sources={Foursquare:key?"error":"missing"};
  if(!key)return res.status(200).json({hotspots:[],sources});

  try{
    const params=new URLSearchParams({
      query:mode==="day"?"attractions":"nightlife",
      ll:`${ATL.lat},${ATL.lon}`,
      radius:String(Math.round(radiusMiles*1609.344)),
      sort:"POPULARITY",
      limit:"30"
    });
    const response=await fetch("https://places-api.foursquare.com/places/search?"+params,{
      headers:{
        Authorization:"Bearer "+key,
        Accept:"application/json",
        "X-Places-Api-Version":"2025-06-17"
      },
      signal:timeout(10000)
    });
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    const rows=Array.isArray(payload?.results)?payload.results:Array.isArray(payload?.places)?payload.places:[];
    const hotspots=rows.map(normalize).slice(0,30);
    sources.Foursquare="ok";
    res.setHeader("Cache-Control","s-maxage=900, stale-while-revalidate=1800");
    return res.status(200).json({
      hotspots,
      sources,
      methodology:"Estimated demand from Foursquare popularity ranking; not live occupancy."
    });
  }catch(error){
    console.error(JSON.stringify({
      level:"error",
      route:"/api/hotspots",
      source:"Foursquare",
      error:error instanceof Error?error.message:String(error)
    }));
    return res.status(200).json({hotspots:[],sources});
  }
};
