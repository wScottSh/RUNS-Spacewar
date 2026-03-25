pico-8 cartridge // http://www.pico-8.com
version 42
__lua__
-- spacewar! 3.1
-- pico-8 runtime
-- hand-transpiled from runs source
-- no sound (original pdp-1 had none)

-- ═══════════════════════════
-- constants (game_constants.runs)
-- all at ÷4 scale where applicable
-- ═══════════════════════════
tno=33   -- max torpedoes (counter)
rlt=16   -- torpedo reload time (frames)
tlf=96   -- torpedo lifetime (frames)
maa=8    -- angular acceleration
me1=768  -- collision radius (÷4)
me2=384  -- collision radius half (÷4)
mhs=8    -- max hyperspace shots
hd1=32   -- hyperspace entry delay
hd2=64   -- hyperspace breakout
hd3=128  -- hyperspace recharge
hur=16384-- uncertainty increment
pi_a=102944 -- ±π in angle units

-- torpedo velocity: sin>>tvl(4)
-- at ÷4: divide by 16 after applying
-- the runs-to-pico scale factor
-- thrust: cos>>sac(4)>>9 = >>13
-- at ÷4: >>11

-- entity states
st_e=0 -- empty
st_s=1 -- ship
st_t=2 -- torpedo
st_x=3 -- exploding
st_hi=4-- hyperspace in
st_ho=5-- hyperspace out

-- ═══════════════════════════
-- entity table (object.runs)
-- 24 slots, 1-indexed
-- ═══════════════════════════
e={}
function make_ent()
 return{st=0,x=0,y=0,
  vx=0,vy=0,lt=0,
  av=0,ang=0,fuel=0,
  torp=0,oref=0,
  pctl=0,hss=0,
  hrt=0,hua=0,thr=false}
end
for i=1,24 do e[i]=make_ent() end

-- match state
sc1=0 sc2=0
rt=0 -- restart timer
reinit=false
-- sense switches
sw={false,false,false,
    false,false,false}
-- spawn queue
spawns={}
-- starfield
sf_off=4096
sf_ctr=-40
stars={}

-- ═══════════════════════════
-- outline data (ship_outlines.json)
-- pre-decoded 3-bit codes from octal
-- words, lsb first per word.
-- 7 at word boundary = terminator.
-- ═══════════════════════════
-- needle: 111131 111111 111111
--         111163 311111 146111
--         111114 700000
outlines={
 {1,3,1,1,1,1,
  1,1,1,1,1,1,
  1,1,1,1,1,1,
  3,6,1,1,1,1,
  1,1,1,1,1,3,
  1,1,1,6,4,1,
  4,1,1,1,1,1},
 -- wedge: 013113 113111 116313
 --        131111 161151 111633
 --        365114 700000
 {3,1,1,3,1,0,
  1,1,1,3,1,1,
  3,1,3,6,1,1,
  1,1,1,1,3,1,
  1,5,1,1,6,1,
  3,3,6,1,1,1,
  4,1,1,5,6,3}
}

-- ═══════════════════════════
-- utility functions
-- ═══════════════════════════

-- arithmetic right shift
-- (flr handles negative correctly)
function asr(v,n)
 return flr(v/(2^n))
end

-- angle to pico-8 turns
function a2t(a)
 return a/(pi_a*2)
end

-- game coords to screen
function gx(x) return 64+x/512 end
function gy(y) return 64-y/512 end

-- ═══════════════════════════
-- match_initialize
-- (match_initialize.runs)
-- ═══════════════════════════
function match_init()
 spawns={}
 rt=0
 for i=1,24 do
  local s=e[i]
  s.st=0 s.x=0 s.y=0
  s.vx=0 s.vy=0 s.lt=0
  s.av=0 s.ang=0 s.fuel=0
  s.torp=0 s.oref=0
  s.pctl=0 s.hss=0
  s.hrt=0 s.hua=0 s.thr=false
 end
 -- ship 1 (needle) ÷4
 local s1=e[1]
 s1.st=st_s
 s1.x=16384 s1.y=16384
 s1.ang=51472
 s1.fuel=-8192
 s1.torp=-tno
 s1.hss=-mhs
 s1.oref=0
 -- ship 2 (wedge) ÷4
 local s2=e[2]
 s2.st=st_s
 s2.x=-16384 s2.y=-16384
 s2.ang=51472
 s2.fuel=-8192
 s2.torp=-tno
 s2.hss=-mhs
 s2.oref=1
end

-- ═══════════════════════════
-- read_input
-- pico-8 btn: 0=l,1=r,2=u,3=d,4=o,5=x
-- ═══════════════════════════
function read_input(p)
 return{
  ccw=btn(0,p),
  cw=btn(1,p),
  thrust=btn(2,p),
  fire=btn(4,p),
  hyp=btn(3,p)
 }
end

-- ═══════════════════════════
-- rotation_update
-- (rotation_update.runs)
-- ═══════════════════════════
function rotation_update(s,ctl)
 local om=s.av
 if ctl.ccw and not ctl.cw then
  om+=maa
 elseif ctl.cw and not ctl.ccw then
  om-=maa
 end
 if sw[1] then om=0 end
 s.av=om

 local a=s.ang+om
 -- normalize (matches runs source:
 -- if a>pi: a-=pi; if a<-pi: a+=pi)
 if a>pi_a then a-=pi_a end
 if a<-pi_a then a+=pi_a end
 s.ang=a

 -- thrust check
 local can=ctl.thrust
 if s.fuel>=0 then can=false end
 s.thr=can

 -- trig cache (pico-8 -1..1)
 local t=a2t(a)
 return sin(t),cos(t),can
end

-- ═══════════════════════════
-- gravity (gravity.runs)
-- ═══════════════════════════
function gravity(s)
 if sw[6] then return 0,0 end

 -- at ÷4 scale: >>9 (original >>11)
 local xn=asr(s.x,9)
 local yn=asr(s.y,9)
 local rsq=xn*xn+yn*yn-1 -- str=1

 if rsq<=0 then
  -- star capture!
  s.vx=0 s.vy=0
  if sw[5] then
   s.x=32767 s.y=32767
  else
   s.st=st_x s.lt=-8
  end
  return 0,0
 end

 local rsqf=rsq+1
 local r=sqrt(rsqf)
 -- pdp-1 sqt operates on 36-bit ac:io
 -- sqrt(rsq*2^18) = sqrt(rsq)*2^9
 -- then >>9 cancels → r_scaled = sqrt(rsq)
 local rsc=flr(r)
 local div=asr(rsc*rsqf,2)
 if sw[2] then div=asr(div,2) end
 if div==0 then return 0,0 end

 return flr(-s.x/div),
        flr(-s.y/div)
end

-- ═══════════════════════════
-- thrust + velocity integrate
-- (thrust.runs, velocity_integrate.runs)
-- ═══════════════════════════
function do_thrust(s,sn,cs,gvx,gvy,on)
 local ax,ay=gvx,gvy

 if on then
  -- thrust force
  -- original: cos>>9>>sac(4) = >>13
  -- pico-8 sin/cos: -1..1
  -- scale to game units:
  -- original had 131072-scale values
  -- at ÷4: 131072/4=32768
  -- >>13 of 32768-scale = 32768>>13=4
  -- so: cs*4 for y-accel, -sn*4 for x
  local ct=flr(cs*4)
  local st_=flr(-sn*4)
  ay+=ct
  ax+=st_

  -- burn fuel
  local f=s.fuel+1
  if f>=0 then f=0 end
  s.fuel=f
 end

 -- diff macro: vel+=acc, pos+=vel>>3
 s.vy+=ay
 s.y+=asr(s.vy,3)
 s.vx+=ax
 s.x+=asr(s.vx,3)
end

-- ═══════════════════════════
-- wrap_position (wrap_position.runs)
-- at ÷4 scale: ±32767
-- ═══════════════════════════
function wrap_pos(s)
 if s.x>32767 then s.x-=65536
 elseif s.x<-32767 then s.x+=65536 end
 if s.y>32767 then s.y-=65536
 elseif s.y<-32767 then s.y+=65536 end
end

-- ═══════════════════════════
-- torpedo_launch (torpedo_launch.runs)
-- ═══════════════════════════
function torpedo_launch(s,ctl,sn,cs)
 -- reload timer
 local rl=s.lt+1
 if rl>=0 then rl=0 end
 s.lt=rl

 local reloaded=(rl>=0) or sw[3]
 if not reloaded then return end

 -- edge detect fire
 if not ctl.fire then
  s.pctl=0 return
 end
 if s.pctl!=0 then return end
 s.pctl=1

 -- ammo check
 local t=s.torp+1
 if t>=0 then
  t=0 s.torp=t return
 end
 s.torp=t

 -- nose position (2× sin/cos offset)
 -- original: sin>>5 * 2
 -- pico-8: sin is -1..1, scale to ÷4
 -- sin goes up to 1.0, at ÷4 game scale
 -- offset should be ~2 pixels = ~1024 units
 local soff=flr(sn*1024)
 local coff=flr(cs*1024)
 local sx=s.x-soff-soff
 local sy=s.y+coff+coff

 -- torpedo velocity: sin>>tvl(4)
 -- at p8 scale: sin*32768>>4 = sin*2048
 -- plus ship velocity
 local tdx=flr(-sn*2048)+s.vx
 local tdy=flr(cs*2048)+s.vy

 add(spawns,{x=sx,y=sy,vx=tdx,vy=tdy})
 s.lt=-rlt
end

-- ═══════════════════════════
-- hyperspace_check
-- (hyperspace_check.runs)
-- ═══════════════════════════
function hyperspace_check(s,ctl)
 local rc=s.hrt+1
 if rc>=0 then rc=0 end
 s.hrt=rc
 if rc<0 then return end
 if s.hss>=0 then return end
 if not ctl.hyp then return end
 s.st=st_hi
 s.lt=-hd1
end

-- ═══════════════════════════
-- ship_update (ship_update.runs)
-- ═══════════════════════════
function ship_update(i,ctl)
 local s=e[i]
 local sn,cs,on=rotation_update(s,ctl)
 local gvx,gvy=gravity(s)
 if s.st!=st_s then return end
 do_thrust(s,sn,cs,gvx,gvy,on)
 wrap_pos(s)
 torpedo_launch(s,ctl,sn,cs)
 hyperspace_check(s,ctl)
end

-- ═══════════════════════════
-- torp_update (torpedo_update.runs)
-- ═══════════════════════════
function torp_update(i)
 local s=e[i]
 local life=s.lt+1
 if life>=0 then
  s.st=st_x s.lt=-2
  return
 end
 s.lt=life

 -- gravity warpage (first-order)
 -- original: x>>9 then >>the(9) = >>18
 -- at ÷4: >>16
 -- these values are very small (< 1 for
 -- positions < 65536), producing gentle
 -- curving toward center
 local ay=asr(s.x,16)
 local ax=asr(s.y,16)

 s.vy+=ay
 s.y+=asr(s.vy,3)
 s.vx+=ax
 s.x+=asr(s.vx,3)
end

-- ═══════════════════════════
-- expl_tick (explosion_tick.runs)
-- ═══════════════════════════
function expl_tick(i)
 local s=e[i]
 s.y+=asr(s.vy,3)
 s.x+=asr(s.vx,3)
 local life=s.lt+1
 if life>=0 then
  s.st=st_e s.lt=0
 else
  s.lt=life
 end
end

-- ═══════════════════════════
-- hyp_transit (hyperspace_transit.runs)
-- ═══════════════════════════
function hyp_transit(i)
 local s=e[i]
 local life=s.lt+1
 if life<0 then
  s.lt=life return
 end
 s.st=st_ho
 -- random displacement
 -- hr1=7 at ÷4 scale
 s.x+=flr((rnd(16384)-8192))
 s.y+=flr((rnd(16384)-8192))
 -- random velocity (hr2=2)
 s.vx=flr(rnd(8192)-4096)
 s.vy=flr(rnd(8192)-4096)
 -- random angle
 local a=flr(rnd(pi_a*4)-pi_a*2)
 for _=1,3 do
  local twopi=pi_a*2
  if a>pi_a then a-=twopi end
  if a<-pi_a then a+=twopi end
 end
 s.ang=a
 s.lt=-hd2
end

-- ═══════════════════════════
-- hyp_break (hyperspace_breakout.runs)
-- ═══════════════════════════
function hyp_break(i)
 local s=e[i]
 local life=s.lt+1
 if life<0 then
  s.lt=life return
 end
 s.st=st_s -- restore
 local sh=s.hss+1
 if sh>=0 then sh=0 end
 s.hss=sh
 s.hrt=-hd3
 local unc=s.hua+hur
 -- death roll: after 4 uses (unc=65536)
 -- P(death) = unc / 65536
 -- using simplified probability
 if flr(rnd(65536))<unc then
  s.st=st_x s.lt=-8
 end
 s.hua=unc
end

-- ═══════════════════════════
-- process_spawns
-- (process_spawns.runs)
-- ═══════════════════════════
function process_spawns()
 for sp in all(spawns) do
  for k=3,24 do
   if e[k].st==st_e then
    local s=e[k]
    s.st=st_t
    s.x=sp.x s.y=sp.y
    s.vx=sp.vx s.vy=sp.vy
    s.lt=-tlf
    break
   end
  end
 end
 spawns={}
end

-- ═══════════════════════════
-- collision_detect
-- (collision_detect.runs)
-- ═══════════════════════════
function collidable(s)
 return s.st==st_s or
        s.st==st_t or
        s.st==st_ho
end

function collision_detect()
 for i=1,23 do
  if collidable(e[i]) then
   for j=i+1,24 do
    if collidable(e[j]) then
     local dx=abs(e[i].x-e[j].x)
     if dx<me1 then
      local dy=abs(e[i].y-e[j].y)
      if dy<me1 then
       if dx+dy<me1+me2 then
        e[i].st=st_x e[i].lt=-12
        e[j].st=st_x e[j].lt=-12
       end
      end
     end
    end
   end
  end
 end
end

-- ═══════════════════════════
-- check_restart
-- (check_restart.runs)
-- ═══════════════════════════
function check_restart()
 local a1=e[1].st==st_s
 local a2=e[2].st==st_s
 if a1 and a2 then
  if e[1].torp>=0 and e[2].torp>=0 then
   local any=false
   for k=3,24 do
    if e[k].st==st_t then
     any=true break
    end
   end
   if not any then rt=-(tlf*2) end
  end
 else
  if rt==0 then rt=-(tlf*2) end
 end
end

-- ═══════════════════════════
-- update_scores
-- (update_scores.runs)
-- ═══════════════════════════
function update_scores()
 if rt==0 then return end
 local t=rt+1
 if t<0 then rt=t
 else
  if e[1].st==st_s then sc1+=1 end
  if e[2].st==st_s then sc2+=1 end
  rt=0 reinit=true
 end
end

-- ═══════════════════════════
-- advance_scroll
-- (advance_starfield_scroll.runs)
-- ═══════════════════════════
function advance_scroll()
 if sw[4] then return end
 sf_ctr+=1
 if sf_ctr>=0 then
  sf_ctr=-40
  sf_off-=1
  if sf_off<0 then sf_off+=8192 end
 end
end

-- ═══════════════════════════
-- decode stars from __gfx__
-- ═══════════════════════════
function decode_stars()
 stars={}
 for i=0,468 do
  local a=i*2
  local b0=peek(a)
  local b1=peek(a+1)
  local sx=band(b0,0x7f)
  local sy=band(b1,0x7f)
  local br=band(shr(b0,7),1)*2
         +band(shr(b1,7),1)+1
  add(stars,{x=sx,y=sy,br=br})
 end
end

-- ═══════════════════════════
-- _init
-- ═══════════════════════════
function _init()
 decode_stars()
 match_init()
end

-- ═══════════════════════════
-- _update (game_tick.runs)
-- ═══════════════════════════
function _update()
 if reinit then
  match_init()
  reinit=false
  return
 end

 -- sense switch menu toggle
 if btnp(5,0) then
  sw_menu=not sw_menu
 end
 if sw_menu then
  -- navigate menu only
  if btnp(2) then sw_sel=max(1,sw_sel-1) end
  if btnp(3) then sw_sel=min(6,sw_sel+1) end
  if btnp(4) then sw[sw_sel]=not sw[sw_sel] end
  return
 end

 local p1=read_input(0)
 local p2=read_input(1)

 -- phase 1: entity dispatch
 spawns={}
 for i=1,24 do
  local s=e[i]
  if s.st==st_s then
   ship_update(i,i==1 and p1 or p2)
  elseif s.st==st_t then
   torp_update(i)
  elseif s.st==st_x then
   expl_tick(i)
  elseif s.st==st_hi then
   hyp_transit(i)
  elseif s.st==st_ho then
   hyp_break(i)
  end
 end

 -- phase 2-5
 process_spawns()
 collision_detect()
 check_restart()
 update_scores()
 advance_scroll()
end

-- ═══════════════════════════
-- draw_outline (outline_format.md)
-- ═══════════════════════════
function draw_outline(px,py,t,codes,col)
 local sn=sin(t)
 local cs=cos(t)
 -- step size in pixels (~2px per step)
 local ssn=sn*2
 local scn=cs*2

 -- direction vector table
 -- from outline_format.md
 local function getdxy(c)
  if c==0 then return  ssn,-scn
  elseif c==1 then return  scn, ssn
  elseif c==2 then return  ssn+scn,-scn+ssn
  elseif c==3 then return -scn,-ssn
  elseif c==4 then return  ssn-scn,-ssn-scn
  elseif c==5 then return -ssn,-scn
  end
  return 0,0
 end

 local cx,cy=px,py
 local x,y=px,py

 for i=1,#codes do
  local c=codes[i]
  if c<=5 then
   local ddx,ddy=getdxy(c)
   x+=ddx y+=ddy
   pset(x,y,col)
  elseif c==6 then
   cx,cy=x,y
  elseif c==7 then
   -- check if this is the terminator
   -- (7 at start of a word boundary where
   --  remaining codes are also 7 or 0)
   if i>=#codes-5 then break end
   -- otherwise restore checkpoint + flip
   x,y=cx,cy
   ssn=-ssn scn=-scn
  end
 end
end

-- ═══════════════════════════
-- draw_explosion
-- ═══════════════════════════
function draw_explosion(s)
 local px=gx(s.x)
 local py=gy(s.y)
 local sp=(-s.lt)*3
 for _=1,12 do
  pset(px+rnd(sp*2)-sp,
       py+rnd(sp*2)-sp,
       rnd()>0.5 and 10 or 9)
 end
end

-- ═══════════════════════════
-- draw_flame
-- ═══════════════════════════
function draw_flame(s)
 local px=gx(s.x)
 local py=gy(s.y)
 local t=a2t(s.ang)
 local sn=sin(t)
 local cs=cos(t)
 for _=1,4 do
  local d=rnd(6)+2
  local sp=rnd(2)-1
  pset(px+sn*d+sp*cs,
       py-cs*d+sp*sn,
       rnd()>0.5 and 10 or 9)
 end
end

-- ═══════════════════════════
-- draw_starfield
-- ═══════════════════════════
function draw_starfield()
 local bcol={7,12,5,1}
 for s in all(stars) do
  local rx=(s.x-flr(sf_off/64))%128
  pset(rx,s.y,bcol[s.br])
 end
end

-- ═══════════════════════════
-- draw central star
-- ═══════════════════════════
function draw_star()
 local f=t()
 local bri=sin(f*3)*2+3
 circfill(64,64,bri/2,
  bri>3 and 7 or 6)
 for _=1,4 do
  pset(64+rnd(4)-2,
       64+rnd(4)-2,7)
 end
end

-- ═══════════════════════════
-- sense switch menu
-- ═══════════════════════════
sw_menu=false
sw_sel=1

function draw_sw_menu()
 rectfill(18,28,110,100,0)
 rect(18,28,110,100,7)
 print("sense switches",26,31,7)
 local nm={
  "1 ang.damping",
  "2 heavy star",
  "3 rapid fire",
  "4 no stars",
  "5 star teleport",
  "6 no gravity"
 }
 for i=1,6 do
  local y=39+(i-1)*10
  local c=sw[i] and 11 or 6
  if i==sw_sel then
   print("▶",20,y,7)
  end
  print(nm[i],28,y,c)
  print(sw[i] and "on" or "--",
        96,y,c)
 end
end

-- ═══════════════════════════
-- _draw
-- ═══════════════════════════
function _draw()
 cls(0)

 if not sw[4] then draw_starfield() end
 if not sw[6] then draw_star() end

 for i=1,24 do
  local s=e[i]
  if s.st==st_s then
   draw_outline(
    gx(s.x),gy(s.y),
    a2t(s.ang),
    outlines[s.oref+1],
    i==1 and 7 or 12)
   if s.thr then draw_flame(s) end
  elseif s.st==st_t then
   pset(gx(s.x),gy(s.y),10)
  elseif s.st==st_x then
   draw_explosion(s)
  elseif s.st==st_ho then
   draw_outline(
    gx(s.x),gy(s.y),
    a2t(s.ang),
    outlines[s.oref+1],5)
  end
 end

 -- score hud
 local stxt=sc1.." - "..sc2
 print(stxt,64-#stxt*2,2,7)

 if sw_menu then draw_sw_menu() end

 -- brief controls help
 if t()<4 then
  rectfill(0,114,127,127,0)
  print("p1: ⬅️➡️⬆️⬇️ 🅾️  ❎menu",
        2,116,5)
  print("p2: ⬅️➡️⬆️⬇️ 🅾️",
        2,122,5)
 end
end

__gfx__
7611467506b2c5f67503a4c183e54380617236ea263c265c16bde52fd519d47d145922c9ff61afe58f517fe66f604f941f830f53cec5be768ea08e316ec26e93
5ee44ee64e353e743eb72e142e272e322e152e401ea6cdb19d019d108d721dc20de2ace09c606cc64c404c21fbe7fb07dbd6cb24bb43abf18b046ba01bc6ea95
cac2ca31ca84baf7aa779a949ac48a207ad54ac64a612ab61a830ab5f942e984b9c7a991a9e4a9c7897369225990493439b62971d815c852c8f6a824a8f28814
782268e65861ff1dff88ff7fefadcffdcfcabf4cafbaaf588f8d7f1b7f7a6ffd6fed6fa86f8b5fdf5f9b4f8a3f4e3f9a2fce2f0c1fae1f4a1f6f1fcf0fad0f7a
fe98fe58feadee7beeefee7aee5adec9defcdebddeefdefbce3ebe9cbed9aefaae18ae4d9e6a9e7a9e6d9e689e499ee89ef88e188ed88e498e698e398e298e0c
8e697e3a7eac7ed97e397e9e7e8f7e9c6e7a6e0b6e0d6e3a6ea95ebb5e4e5e4d5e9f5e385e494e494e9d4e2e4e8b4e5e4e5e3ecf3e1c3e6b3e6d3ebb3e183e7b
3efa2eb82e5d2e5a2e1d2eec2e5a2e7c2e4b2e4d2e191eff1ec91ebf1e680e8e0e8c0e4a0eed0e68fdaefd69fd29fd79fd1dfd6eed2bdd68dddcdd3dddbadd6f
dd3fcd8ecd3acda9cd8bbda9bd9fbd1ebd9fbd0fadbcad58adcead1c9d5f8d6a8dd98def7dad5d3f5d3c5d8b5d7c4d5f4d4e4d5a3dac2dea2d5b2dce2d181d5b
1d3d1db81d5e1dea0dd9fc8bec0eecaddc6cdc2cdc1bcc2ccc7ecc2abc8ebc7aac3eac2aacfbac1e9c788cee8c0c8c4a5c2f5c5c5c585c9a4cff4c8c4c8e3cda
3c0a3c0f2cad2c0c1c2f1cba1c481c9b0cbafb5aeb0cebb8dbcecb5dcb1abb9dbbc8abecabc89b2f8bce8b0d8b4b6bc86b195bab4b7b4bbd4bfc4b4e4b093b5c
2b092b791bec1be81b9b1b880bbc0b8bfa7fdabdda9eda1aca7fca78caaacab8ba2bba38baeeba29ba7eaafdaaafaaafaa6faabd9acb9a889a8f8a798a3f8a7d
8aee8a9b8acf8ae96aed6a2a5a4a5ab94a1c4abf3a4e3aec3a4b2a6d2a4e2adf0aac0a3b0a090a7b0acbf98bf97af948f9cfe96be918e99de9afe928d99ed97d
c958c9dcc9c8b94bb959a90da9ef9938993f99ee89fb89ba7988794c79d879e869c869a869db698a69ea4959494e494e395e393f290a2979294c294829391969
193919cd19fc19ad099ff82ff81ef84af84af82be81fe888d8ffd88fd87dc80fc87fc809a87ca83ba88e987d985c98e988db884b88fd781c787f68e9688e687d
688a586b586a48df482d48bd488b48bd38af38cf38eb38fa38d928df281b284f28cb28be08ea082d082f00000000000000000000000000000000000000000000

