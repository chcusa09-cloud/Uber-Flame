const {requireAdmin}=require("./_auth");
module.exports=(req,res)=>{
  if(!requireAdmin(req,res))return;
  const keys=["RAPIDAPI_KEY","AERODATABOX_KEY","BESTTIME_PUBLIC_KEY","BESTTIME_PRIVATE_KEY","PREDICTHQ_TOKEN","TICKETMASTER_KEY","ADMIN_USER","ADMIN_PASSWORD","AUTH_SECRET"];
  const configured={}; keys.forEach(k=>configured[k]=Boolean(process.env[k]));
  res.status(200).json({ok:true,configured});
};