const {COOKIE}=require("./_auth");
module.exports=(req,res)=>{res.setHeader("Set-Cookie",`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);res.status(200).json({ok:true})};