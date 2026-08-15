const crypto=require("crypto");
const {COOKIE,makeToken}=require("./_auth");
function safeEq(a,b){
  const A=Buffer.from(String(a||"")); const B=Buffer.from(String(b||""));
  if(A.length!==B.length)return false;
  return crypto.timingSafeEqual(A,B);
}
module.exports=async(req,res)=>{
  if(req.method!=="POST")return res.status(405).json({ok:false});
  const user=req.body?.username||""; const pass=req.body?.password||"";
  if(!process.env.ADMIN_USER||!process.env.ADMIN_PASSWORD||!process.env.AUTH_SECRET)
    return res.status(503).json({ok:false,error:"Admin credentials are not configured on the server."});
  if(!safeEq(user,process.env.ADMIN_USER)||!safeEq(pass,process.env.ADMIN_PASSWORD))
    return res.status(401).json({ok:false,error:"Invalid username or password."});
  const token=makeToken();
  res.setHeader("Set-Cookie",`${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);
  return res.status(200).json({ok:true});
};