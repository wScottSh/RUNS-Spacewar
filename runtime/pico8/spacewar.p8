pico-8 cartridge // http://www.pico-8.com
version 42
__lua__
-- spacewar! 3.1 — runs→pico-8 hand-transpilation
-- source: runs-spacewar/src/
-- egs: enduring game standard

-- ══════════════════════════════════════════
-- ÷4 SCALING PRINCIPLE:
-- all 18-bit position-space values ÷4
-- game logic is UNTOUCHED — scaling at
-- boundaries only (init + rendering)
-- ══════════════════════════════════════════

-- states
st_e=0 st_s=1 st_t=2
st_x=3 st_hi=4 st_ho=5

-- constants (game_constants.runs)
-- position-space (÷4):
c_me1=768 c_me2=384     -- collision radii
c_ipos=16384             -- init position (65536÷4)
c_iang=12868             -- init angle π (51472÷4)
c_2pi=25736              -- full circle (102944÷4)
c_maa=2                  -- angular accel (8÷4!!!)
c_str=1                  -- star capture r²
c_hur=4096               -- hyperspace uncertainty (16384÷4)
-- non-position (unchanged):
c_nt=33 c_tvl=4 c_rlt=16
c_tlf=96 c_the=9
c_fuel=-8192 c_sac=4
c_mhs=8 c_hd1=32 c_hd2=64
c_hd3=128

-- outlines (MSB-first 3-bit codes)
needle={1,1,1,1,3,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,6,3,3,1,1,1,1,1,1,4,6,1,1,1,1,1,1,1,1,4}
wedge={0,1,3,1,1,3,1,1,3,1,1,1,1,1,6,3,1,3,1,3,1,1,1,1,1,6,1,1,5,1,1,1,1,6,3,3,3,6,5,1,1,4}
dirs={{0,-1},{0,-1},{1,0},{1,-1},{-1,0},{-1,-1}}

-- star catalog (tiers 1-3, 99 stars)
stars={
-- tier 1-2 (18 stars)
{6655,371,1},{6430,-189,1},{6202,168,1},{5912,-377,1},{5609,125,1},
{4761,283,1},{3641,-242,1},{3350,448,1},{1445,196,1},
{6373,143,2},{6308,-29,2},{6282,-46,2},{6241,-221,2},{6040,-407,2},
{5962,375,2},{4991,-187,2},{4187,344,2},{2217,288,2},
-- tier 3 (81 stars)
{8146,333,3},{7830,-244,3},{7702,338,3},{7626,-375,3},{7571,462,3},
{7428,-78,3},{7292,64,3},{7185,84,3},{6949,-230,3},{6864,-314,3},
{6697,432,3},{6696,356,3},{6574,154,3},{6548,52,3},{6469,-119,3},
{6437,-371,3},{6413,-158,3},{6375,-57,3},{6349,-474,3},{6332,-8,3},
{6324,-407,3},{6317,225,3},{6312,-136,3},{6305,480,3},{6244,-338,3},
{5918,296,3},{5732,380,3},{5722,504,3},{5679,193,3},{5225,154,3},
{5176,144,3},{4768,393,3},{4696,463,3},{4524,-357,3},{4387,479,3},
{4386,364,3},{4068,-502,3},{4035,-387,3},{3956,-363,3},{3888,-21,3},
{3808,90,3},{3771,262,3},{3586,-2,3},{3471,430,3},{3155,-356,3},
{3006,-205,3},{2848,153,3},{2835,358,3},{2819,-71,3},{2762,-508,3},
{2733,-445,3},{2679,-78,3},{2656,-101,3},{2583,494,3},{2551,-236,3},
{2364,-355,3},{2332,330,3},{2208,-349,3},{2145,63,3},{2085,-222,3},
{2033,217,3},{1956,-66,3},{1753,-483,3},{1702,312,3},{1701,-115,3},
{1685,-482,3},{1590,66,3},{1471,236,3},{1398,437,3},{1330,-25,3},
{1278,-344,3},{1178,324,3},{874,-137,3},{801,214,3},{788,-377,3},
{679,-18,3},{653,130,3},{548,-12,3},{475,235,3},{402,-372,3},
{343,334,3},
-- tier 4 (every ~5th, 74 stars for density)
{8191,-143,4},{8110,-214,4},{7919,-38,4},{7742,-198,4},{7597,-255,4},
{7575,61,4},{7465,191,4},{7379,182,4},{7314,-2,4},{7284,221,4},
{7245,-487,4},{7200,194,4},{7116,470,4},{7088,68,4},{7057,198,4},
{7024,287,4},{7001,-500,4},{6932,-283,4},{6854,278,4},{6834,497,4},
{6778,205,4},{6766,-178,4},{6746,350,4},{6722,392,4},{6715,403,4},
{6707,330,4},{6685,364,4},{6666,333,4},{6648,-81,4},{6636,358,4},
{6621,-452,4},{6570,199,4},{6554,-128,4},{6538,304,4},{6487,-64,4},
{6425,-286,4},{6380,-265,4},{6332,-179,4},{6300,-21,4},{6240,106,4},
{6190,-107,4},{6122,-390,4},{6103,-212,4},{5895,-267,4},{5844,285,4},
{5783,325,4},{5680,-482,4},{5631,-345,4},{5575,-48,4},{5456,306,4},
{5363,-67,4},{5222,-309,4},{5080,-244,4},{4961,-404,4},{4810,283,4},
{4660,195,4},{4473,256,4},{4308,413,4},{4150,-291,4},{3973,-439,4},
{3826,355,4},{3692,-168,4},{3544,159,4},{3375,-449,4},{3202,250,4},
{3025,94,4},{2897,-134,4},{2754,433,4},{2598,-314,4},{2445,98,4},
{2271,-163,4},{2118,383,4},{1932,-259,4},{1796,107,4}
}

-- entity table
ents={} spawn_q={}
sc1=0 sc2=0 m_rtimer=0 m_reinit=false
sf_off=4096 sf_fc=-2 sf_sc=-16
sw={false,false,false,false,false,false}
tick=0
dbg="" -- torpedo debug output

-- ══════════════════════════════════════════
-- RENDERING BOUNDARY (game → screen)
-- runtime_contract.md part 5:
-- screen_x = game_x/131072 * W/2 + W/2
-- with ÷4: screen_x = x/32768*64+64 = x/512+64
-- ══════════════════════════════════════════
function gx(x) return 64+x/512 end
function gy(y) return 64-y/512 end

-- ══════════════════════════════════════════
function _init() match_init() end

function match_init()
 ents={} spawn_q={}
 for i=1,24 do
  ents[i]={
   st=st_e,col=false,
   x=0,y=0,vx=0,vy=0,
   ang=0,av=0,fuel=0,
   torps=0,life=0,
   sn=0,cs=0,gvx=0,gvy=0,
   te=false,fl=0,pc=0,ps=0,
   oref=0,
   hss=st_e,hsr=0,hrt=0,hua=0
  }
 end
 local s1=ents[1]
 s1.st=st_s s1.col=true
 s1.x=c_ipos s1.y=c_ipos
 s1.ang=c_iang s1.oref=0
 s1.torps=-c_nt s1.fuel=c_fuel
 s1.hsr=-c_mhs
 local s2=ents[2]
 s2.st=st_s s2.col=true
 s2.x=-c_ipos s2.y=-c_ipos
 s2.ang=0 s2.oref=1
 s2.torps=-c_nt s2.fuel=c_fuel
 s2.hsr=-c_mhs
 m_rtimer=-c_tlf*2 m_reinit=false
end

-- ══════════════════════════════════════════
-- _update: 15fps effective (skip frames)
-- runtime_contract.md: PDP-1 ran at ~15fps
-- pico-8 _update runs at 30fps → skip odd
-- ══════════════════════════════════════════
f1_fire=false f2_fire=false
f1_prev=false f2_prev=false

function _update()
 -- always poll fire for edge detection
 local f1=btn(4,0) local f2=btn(4,1)
 if f1 and not f1_prev then f1_fire=true end
 if f2 and not f2_prev then f2_fire=true end
 f1_prev=f1 f2_prev=f2

 tick+=1
 if tick%2~=0 then return end -- 15fps

 local c1={
  ccw=btn(0,0),cw=btn(1,0),
  thr=btn(2,0),fire=f1_fire,
  hyp=btn(5,0)
 }
 local c2={
  ccw=btn(0,1),cw=btn(1,1),
  thr=btn(2,1),fire=f2_fire,
  hyp=btn(5,1)
 }
 f1_fire=false f2_fire=false

 -- phase 1: entity dispatch
 spawn_q={}
 for i=1,24 do
  local e=ents[i]
  if e.st==st_s then
   ship_update(e,i==1 and c1 or c2,i)
  elseif e.st==st_t then
   torp_update(e)
  elseif e.st==st_x then
   expl_tick(e,i)
  elseif e.st==st_hi then
   hyp_transit(e)
  elseif e.st==st_ho then
   hyp_break(e)
  end
 end
 proc_spawns()
 coll_detect()
 chk_restart()
 upd_scores()
 adv_scroll()
 if m_reinit then match_init() end
end

-- ══════════════════════════════════════════
-- ship_update (ship_update.runs, 6 steps)
-- ══════════════════════════════════════════
function ship_update(e,ctl,slot)
 -- 1: rotation (rotation_update.runs)
 local fd=0
 if ctl.ccw and ctl.cw then fd=0
 elseif ctl.ccw then fd=c_maa
 elseif ctl.cw then fd=-c_maa end
 local nav=fd+e.av
 local omega,rot
 if sw[1] then omega=0 rot=nav*128
 else omega=nav rot=nav end
 local can_thr=ctl.thr and e.fuel<0
 local a=rot+e.ang
 if a>=0 then a=a-c_2pi end
 if a<0 then a=a+c_2pi end
 -- trig via pico-8 built-in (adapted compilation)
 local t=a/c_2pi
 local sn=-sin(t)*32767
 local cs=cos(t)*32767
 e.av=omega e.ang=a
 e.sn=sn e.cs=cs e.te=can_thr

 -- 2: gravity (gravity.runs)
 if sw[6] then
  e.gvx=0 e.gvy=0
 else
  -- xn = pos >> 11. In ÷4 space: (pos÷4)/512 = pos/2048
  local xn=flr(e.x/512)
  local yn=flr(e.y/512)
  local rsq=xn*xn+yn*yn-c_str
  if rsq<=0 then
   e.vx=0 e.vy=0
   if sw[5] then
    e.x=32767 e.y=32767
    e.gvx=0 e.gvy=0
   else
    e.st=st_x e.col=false e.life=-8
    e.gvx=0 e.gvy=0 return
   end
  else
   local rsqf=rsq+c_str
   local r=sqrt(rsqf)
   if r<0.01 then
    e.gvx=0 e.gvy=0
   else
    -- gravity = -pos / (sqrt*r²>>shifts)
    -- rewritten: -pos/r/rsqf*factor (overflow-safe)
    -- heavy(sw2): 1 scr2s → div=prod/4 → factor=4
    -- light(default): 2 scr2s → div=prod/16 → factor=1
    local fac=sw[2] and 4 or 1
    e.gvx=flr(-e.x/r/rsqf*fac)
    e.gvy=flr(-e.y/r/rsqf*fac)
   end
  end
 end

 -- 3: thrust + velocity integration (thrust.runs)
 local ct=flr(e.cs/8192)
 local accy=can_thr and ct+e.gvy or e.gvy
 local st=-flr(e.sn/8192)
 local accx=can_thr and st+e.gvx or e.gvx
 -- diff macro: vel+=acc, pos+=vel>>3
 e.vy=e.vy+accy e.y=e.y+flr(e.vy/8)
 e.vx=e.vx+accx e.x=e.x+flr(e.vx/8)

 -- exhaust (exhaust_burn.runs)
 if can_thr then
  local fl=flr(rnd(16))
  local burn=min(fl,-e.fuel)
  e.fuel=e.fuel+burn
  if e.fuel>=0 then e.fuel=0 end
  e.fl=burn
 else e.fl=0 end

 -- 4: wrap (ones-complement overflow)
 if e.x>32767 then e.x=e.x-65535
 elseif e.x<-32767 then e.x=e.x+65535 end
 if e.y>32767 then e.y=e.y-65535
 elseif e.y<-32767 then e.y=e.y+65535 end

 -- 5: torpedo launch (torpedo_launch.runs)
 local reload=e.life+1
 if reload>=0 then reload=0 end
 e.life=reload
 if (reload>=0 or sw[3]) and ctl.fire then
  local torps=e.torps+1
  if torps>=0 then e.torps=0
  else
   e.torps=torps
   -- DEBUG: store torpedo angle data for _draw
   dbg="a="..flr(e.ang).." sn="..flr(e.sn).." cs="..flr(e.cs)
   local so=flr(e.sn/32)
   local co=flr(e.cs/32)
   local nx=e.x-so-so
   local ny=e.y+co+co
   local tdx=-flr(e.sn/16)+e.vx
   local tdy=flr(e.cs/16)+e.vy
   add(spawn_q,{x=nx,y=ny,dx=tdx,dy=tdy})
   e.life=-c_rlt
  end
 end

 -- 6: hyperspace check (hyperspace_check.runs)
 local hrt=e.hrt+1
 if hrt<0 then e.hrt=hrt
 else
  e.hrt=0
  if e.hsr~=0 and ctl.hyp then
   e.hss=e.st
   e.st=st_hi e.col=false
   e.life=-c_hd1
  end
 end
end

-- ══════════════════════════════════════════
function torp_update(e)
 local life=e.life+1
 if life>=0 then
  e.st=st_x e.col=false e.life=-2
 else
  e.life=life
  -- warpage: with the=9, total shift=18 → 0
  local ay=flr(e.x/262144)
  e.vy=e.vy+ay e.y=e.y+flr(e.vy/8)
  local ax=flr(e.y/262144)
  e.vx=e.vx+ax e.x=e.x+flr(e.vx/8)
 end
end

-- ══════════════════════════════════════════
function expl_tick(e,slot)
 e.x=e.x+flr(e.vx/8)
 e.y=e.y+flr(e.vy/8)
 e.pc=slot<=2 and 128 or 2
 e.ps=rnd(32767)
 local life=e.life+1
 if life>0 then e.st=st_e e.col=false e.life=0
 else e.life=life end
end

-- ══════════════════════════════════════════
function hyp_transit(e)
 local life=e.life+1
 if life<=0 then e.life=life
 else
  e.st=st_ho e.col=true
  e.x=e.x+(rnd(2)-1)*512
  e.y=e.y+(rnd(2)-1)*512
  e.vx=(rnd(2)-1)*16
  e.vy=(rnd(2)-1)*16
  e.ang=flr(rnd(c_2pi))
  e.life=-c_hd2
 end
end

-- ══════════════════════════════════════════
function hyp_break(e)
 local life=e.life+1
 if life<=0 then e.life=life
 else
  e.st=e.hss e.col=true
  local shots=e.hsr+1
  if shots>0 then shots=0 end
  e.hsr=shots e.hrt=-c_hd3
  local unc=e.hua+c_hur
  e.hua=unc
  if -(rnd(32767))-1+unc>=0 then
   e.st=st_x e.col=false e.life=-8
  end
 end
end

-- ══════════════════════════════════════════
function proc_spawns()
 for req in all(spawn_q) do
  for i=3,24 do
   if ents[i].st==st_e then
    local e=ents[i]
    e.st=st_t e.col=true
    e.x=req.x e.y=req.y
    e.vx=req.dx e.vy=req.dy
    e.life=-c_tlf break
   end
  end
 end
end

-- ══════════════════════════════════════════
function coll_detect()
 for i=1,23 do
  if ents[i].col then
   for j=i+1,24 do
    if ents[j].col then
     local dx=abs(ents[i].x-ents[j].x)
     local dy=abs(ents[i].y-ents[j].y)
     if dx<c_me1 and dy<c_me1 and dx+dy<c_me1+c_me2 then
      local bi=ents[i].st==st_s and 1024 or 16
      local bj=ents[j].st==st_s and 1024 or 16
      local el=flr(-(bi+bj)/256)+1
      ents[i].st=st_x ents[i].col=false ents[i].life=el
      ents[j].st=st_x ents[j].col=false ents[j].life=el
     end
    end
   end
  end
 end
end

-- ══════════════════════════════════════════
function chk_restart()
 local s1a=ents[1].st==st_s
 local s2a=ents[2].st==st_s
 if s1a and s2a then
  if ents[1].torps+1>=0 and ents[2].torps+1>=0 then
   m_rtimer=m_rtimer+1
  else m_rtimer=-c_tlf*2 end
 else m_rtimer=m_rtimer+1 end
end

-- ══════════════════════════════════════════
function upd_scores()
 if m_rtimer>=0 and m_rtimer~=0 then
  if ents[1].st==st_s then sc1+=1 end
  if ents[2].st==st_s then sc2+=1 end
  m_rtimer=0 m_reinit=true
 end
end

-- ══════════════════════════════════════════
function adv_scroll()
 if sw[4] then return end
 sf_fc+=1
 if sf_fc<0 then return end
 sf_fc=-2
 sf_sc+=1
 if sf_sc<0 then return end
 sf_sc=-16
 sf_off-=1
 if sf_off<0 then sf_off+=8192 end
end

-- ══════════════════════════════════════════
-- _draw: RENDERING BOUNDARY
-- all platform adaptation happens here
-- ══════════════════════════════════════════

-- outline scale: W/1024 = 128/1024 = 0.125
-- with 2× visibility factor: 0.25
-- (outline_format.md line 73-79)
o_sc=0.25

function _draw()
 cls(0)
 if not sw[4] then draw_stars() end
 if not sw[6] then draw_cstar() end
 for i=1,24 do
  local e=ents[i]
  if e.st==st_s then draw_ship(e)
  elseif e.st==st_t then
   pset(gx(e.x),gy(e.y),10)
  elseif e.st==st_x then draw_expl(e)
  elseif e.st==st_ho then
   if rnd(1)>0.3 then pset(gx(e.x),gy(e.y),6) end
  end
 end
 print(sc1,2,2,7)
 print(sc2,116,2,12)
 if #dbg>0 then print(dbg,0,122,8) end
end

-- ══════════════════════════════════════════
-- draw_ship: outline renderer
-- outline_format.md rendering algorithm §
-- CRITICAL: draw from NOSE position, not center
-- L1191-1197: sx1=pos_x-sin>>5, sy1=pos_y+cos>>5
-- ══════════════════════════════════════════
function draw_ship(e)
 local data=e.oref==0 and needle or wedge
 local t=e.ang/c_2pi
 local sa=-sin(t) local ca=cos(t)
 -- center outline on entity position:
 -- code-1 draws in direction (sa, -ca) on screen
 -- shift start BACKWARD by half body length
 local half=e.oref==0 and 10 or 7
 local cx=gx(e.x)+sin(t)*o_sc*half
 local cy=gy(e.y)+cos(t)*o_sc*half
 local clr=e.oref==0 and 7 or 12
 local sx,sy=0,0
 local ckx,cky=0,0

 for pass=0,1 do
  sx=0 sy=0
  for _,c in ipairs(data) do
   if c<=5 then
    local dx,dy=dirs[c+1][1],dirs[c+1][2]
    if pass==1 then dx=-dx end
    local rx=dx*ca-dy*sa
    local ry=dx*sa+dy*ca
    sx+=rx*o_sc sy+=ry*o_sc
    pset(cx+sx,cy+sy,clr)
   elseif c==6 then
    ckx=sx cky=sy
   end
  end
 end

 -- exhaust flame from TAIL (opposite nose)
 -- heading = (-sin, cos) in game coords
 -- tail direction = (sin, -cos) = opposite heading
 -- on screen with Y-flip: tail_dy = +cos (downward)
 if e.fl>0 then
  local fdx=sin(t)*o_sc
  local fdy=cos(t)*o_sc
  for i=1,min(e.fl,6) do
   pset(cx+fdx*i+rnd(1)-0.5,cy+fdy*i+rnd(1)-0.5,9)
  end
 end
end

-- ══════════════════════════════════════════
-- draw_expl: scattered particles
-- ══════════════════════════════════════════
function draw_expl(e)
 -- explosion_tick.runs: scatter is 9-bit random >> 1 or >> 3
 -- at ÷4 128px scale these are sub-pixel offsets
 -- visual comes from drift (vel integration) over frames
 srand(e.ps)
 local cx,cy=gx(e.x),gy(e.y)
 local n=min(e.pc,32)
 for i=1,n do
  -- sub-pixel scatter: ±1px max (authentic proportion)
  pset(cx+rnd(2)-1,cy+rnd(2)-1,7+flr(rnd(3)))
 end
 srand(time())
end

-- ══════════════════════════════════════════
-- draw_stars: expensive planetarium
-- runtime_contract.md §starfield:
--   render_x = star.x - scroll_offset (wrap at 8192)
--   render_y = star.y * 256
--   both mapped through game→screen formula
-- PDP-1 shows 1024-unit window of 8192 catalog
-- ══════════════════════════════════════════
function draw_stars()
 for s in all(stars) do
  local rx=(s[1]-sf_off)%8192
  -- only stars in visible 1024-unit window
  if rx<1024 then
   -- map catalog x [0,1024] → game coords
   -- 1024 catalog units = full screen width
   -- game screen = ±32768 ÷4 coords, mapped via /512+64
   -- catalog 0→screen 0, catalog 1024→screen 127
   local px=rx*128/1024
   -- render_y = star.y * 256 → game coords (in 18-bit)
   -- ÷4 → star.y * 64. map via gy()
   local py=gy(s[2]*64)
   local c=s[3]<=1 and 7 or (s[3]==2 and 6 or 5)
   pset(px,py,c)
  end
 end
end

-- ══════════════════════════════════════════
-- draw_cstar: random dot line through origin
-- runtime_contract.md §central_star (L522-561):
--   up to 20 dots along random direction,
--   then mirror. NOT a circle.
-- ══════════════════════════════════════════
function draw_cstar()
 pset(64,64,7)
 local bx=(rnd(2)-1)*0.5
 local by=(rnd(2)-1)*0.5
 for i=1,6 do
  pset(64+bx*i,64+by*i,7)
  pset(64-bx*i,64-by*i,7)
 end
end
__gfx__
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
__gff__
0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
__map__
__sfx__
__music__
