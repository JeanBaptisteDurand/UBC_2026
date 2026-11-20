var Nh="160";var dg=0,yd=1,fg=2;var lp=1,Uh=2,Si=3,oi=0,Mn=1,Jt=2;var qi=0,yr=1,vd=2,Md=3,Sd=4,pg=5,Ss=100,mg=101,gg=102,Ed=103,bd=104,_g=200,xg=201,yg=202,vg=203,Xl=204,ql=205,Mg=206,Sg=207,Eg=208,bg=209,wg=210,Tg=211,Ag=212,Rg=213,Cg=214,Pg=0,Lg=1,Ig=2,Ba=3,Dg=4,Ng=5,Ug=6,Og=7,hp=0,Fg=1,Bg=2,ri=0,kg=1,zg=2,Hg=3,Gg=4,Vg=5,Wg=6,wd="attached",Xg="detached",up=300,Er=301,br=302,Yl=303,Zl=304,Tc=306,Ti=1e3,Cn=1001,bo=1002,zt=1003,ka=1004;var xo=1005;var _n=1006,Oh=1007;var Ki=1008;var Yi=1009,qg=1010,Yg=1011,Fh=1012,dp=1013,Wi=1014,bi=1015,wo=1016,fp=1017,pp=1018,ws=1020,Zg=1021,Bn=1023,Kg=1024,$g=1025,Ts=1026,wr=1027,Jg=1028,mp=1029,jg=1030,gp=1031,_p=1033,cl=33776,ll=33777,hl=33778,ul=33779,Td=35840,Ad=35841,Rd=35842,Cd=35843,xp=36196,Pd=37492,Ld=37496,Id=37808,Dd=37809,Nd=37810,Ud=37811,Od=37812,Fd=37813,Bd=37814,kd=37815,zd=37816,Hd=37817,Gd=37818,Vd=37819,Wd=37820,Xd=37821,dl=36492,qd=36494,Yd=36495,Qg=36283,Zd=36284,Kd=36285,$d=36286,Bh=2200,e0=2201,t0=2202,Tr=2300,Rs=2301,fl=2302,pr=2400,mr=2401,za=2402,kh=2500,n0=2501,yp=0,Ac=1,Ho=2,vp=3e3,As=3001,i0=3200,s0=3201,Mp=0,r0=1,kn="",_t="srgb",Ht="srgb-linear",zh="display-p3",Rc="display-p3-linear",Ha="linear",wt="srgb",Ga="rec709",Va="p3";var Js=7680;var Jd=519,o0=512,a0=513,c0=514,Sp=515,l0=516,h0=517,u0=518,d0=519,Kl=35044;var jd="300 es",$l=1035,wi=2e3,Wa=2001,Ai=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;let n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;let s=this._listeners[e];if(s!==void 0){let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){if(this._listeners===void 0)return;let n=this._listeners[e.type];if(n!==void 0){e.target=this;let s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,e);e.target=null}}},cn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Qd=1234567,vr=Math.PI/180,Ar=180/Math.PI;function zn(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(cn[i&255]+cn[i>>8&255]+cn[i>>16&255]+cn[i>>24&255]+"-"+cn[e&255]+cn[e>>8&255]+"-"+cn[e>>16&15|64]+cn[e>>24&255]+"-"+cn[t&63|128]+cn[t>>8&255]+"-"+cn[t>>16&255]+cn[t>>24&255]+cn[n&255]+cn[n>>8&255]+cn[n>>16&255]+cn[n>>24&255]).toLowerCase()}function $t(i,e,t){return Math.max(e,Math.min(t,i))}function Hh(i,e){return(i%e+e)%e}function f0(i,e,t,n,s){return n+(i-e)*(s-n)/(t-e)}function p0(i,e,t){return i!==e?(t-i)/(e-i):0}function yo(i,e,t){return(1-t)*i+t*e}function m0(i,e,t,n){return yo(i,e,1-Math.exp(-t*n))}function g0(i,e=1){return e-Math.abs(Hh(i,e*2)-e)}function _0(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*(3-2*i))}function x0(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*i*(i*(i*6-15)+10))}function y0(i,e){return i+Math.floor(Math.random()*(e-i+1))}function v0(i,e){return i+Math.random()*(e-i)}function M0(i){return i*(.5-Math.random())}function S0(i){i!==void 0&&(Qd=i);let e=Qd+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function E0(i){return i*vr}function b0(i){return i*Ar}function Jl(i){return(i&i-1)===0&&i!==0}function w0(i){return Math.pow(2,Math.ceil(Math.log(i)/Math.LN2))}function Xa(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function T0(i,e,t,n,s){let r=Math.cos,o=Math.sin,a=r(t/2),c=o(t/2),l=r((e+n)/2),h=o((e+n)/2),u=r((e-n)/2),d=o((e-n)/2),f=r((n-e)/2),m=o((n-e)/2);switch(s){case"XYX":i.set(a*h,c*u,c*d,a*l);break;case"YZY":i.set(c*d,a*h,c*u,a*l);break;case"ZXZ":i.set(c*u,c*d,a*h,a*l);break;case"XZX":i.set(a*h,c*m,c*f,a*l);break;case"YXY":i.set(c*f,a*h,c*m,a*l);break;case"ZYZ":i.set(c*m,c*f,a*h,a*l);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+s)}}function si(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function gt(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}var Fr={DEG2RAD:vr,RAD2DEG:Ar,generateUUID:zn,clamp:$t,euclideanModulo:Hh,mapLinear:f0,inverseLerp:p0,lerp:yo,damp:m0,pingpong:g0,smoothstep:_0,smootherstep:x0,randInt:y0,randFloat:v0,randFloatSpread:M0,seededRandom:S0,degToRad:E0,radToDeg:b0,isPowerOfTwo:Jl,ceilPowerOfTwo:w0,floorPowerOfTwo:Xa,setQuaternionFromProperEuler:T0,normalize:gt,denormalize:si},se=class i{constructor(e=0,t=0){i.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos($t(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,o=this.y-e.y;return this.x=r*n-o*s+e.x,this.y=r*s+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},je=class i{constructor(e,t,n,s,r,o,a,c,l){i.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,c,l)}set(e,t,n,s,r,o,a,c,l){let h=this.elements;return h[0]=e,h[1]=s,h[2]=a,h[3]=t,h[4]=r,h[5]=c,h[6]=n,h[7]=o,h[8]=l,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[3],c=n[6],l=n[1],h=n[4],u=n[7],d=n[2],f=n[5],m=n[8],_=s[0],g=s[3],p=s[6],v=s[1],x=s[4],S=s[7],P=s[2],T=s[5],R=s[8];return r[0]=o*_+a*v+c*P,r[3]=o*g+a*x+c*T,r[6]=o*p+a*S+c*R,r[1]=l*_+h*v+u*P,r[4]=l*g+h*x+u*T,r[7]=l*p+h*S+u*R,r[2]=d*_+f*v+m*P,r[5]=d*g+f*x+m*T,r[8]=d*p+f*S+m*R,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],c=e[6],l=e[7],h=e[8];return t*o*h-t*a*l-n*r*h+n*a*c+s*r*l-s*o*c}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],c=e[6],l=e[7],h=e[8],u=h*o-a*l,d=a*c-h*r,f=l*r-o*c,m=t*u+n*d+s*f;if(m===0)return this.set(0,0,0,0,0,0,0,0,0);let _=1/m;return e[0]=u*_,e[1]=(s*l-h*n)*_,e[2]=(a*n-s*o)*_,e[3]=d*_,e[4]=(h*t-s*c)*_,e[5]=(s*r-a*t)*_,e[6]=f*_,e[7]=(n*c-l*t)*_,e[8]=(o*t-n*r)*_,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,o,a){let c=Math.cos(r),l=Math.sin(r);return this.set(n*c,n*l,-n*(c*o+l*a)+o+e,-s*l,s*c,-s*(-l*o+c*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(pl.makeScale(e,t)),this}rotate(e){return this.premultiply(pl.makeRotation(-e)),this}translate(e,t){return this.premultiply(pl.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},pl=new je;function Ep(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function To(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function A0(){let i=To("canvas");return i.style.display="block",i}var ef={};function vo(i){i in ef||(ef[i]=!0,console.warn(i))}var tf=new je().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),nf=new je().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),sa={[Ht]:{transfer:Ha,primaries:Ga,toReference:i=>i,fromReference:i=>i},[_t]:{transfer:wt,primaries:Ga,toReference:i=>i.convertSRGBToLinear(),fromReference:i=>i.convertLinearToSRGB()},[Rc]:{transfer:Ha,primaries:Va,toReference:i=>i.applyMatrix3(nf),fromReference:i=>i.applyMatrix3(tf)},[zh]:{transfer:wt,primaries:Va,toReference:i=>i.convertSRGBToLinear().applyMatrix3(nf),fromReference:i=>i.applyMatrix3(tf).convertLinearToSRGB()}},R0=new Set([Ht,Rc]),ft={enabled:!0,_workingColorSpace:Ht,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(i){if(!R0.has(i))throw new Error(`Unsupported working color space, "${i}".`);this._workingColorSpace=i},convert:function(i,e,t){if(this.enabled===!1||e===t||!e||!t)return i;let n=sa[e].toReference,s=sa[t].fromReference;return s(n(i))},fromWorkingColorSpace:function(i,e){return this.convert(i,this._workingColorSpace,e)},toWorkingColorSpace:function(i,e){return this.convert(i,e,this._workingColorSpace)},getPrimaries:function(i){return sa[i].primaries},getTransfer:function(i){return i===kn?Ha:sa[i].transfer}};function Mr(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function ml(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}var js,qa=class{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{js===void 0&&(js=To("canvas")),js.width=e.width,js.height=e.height;let n=js.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=js}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=To("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=Mr(r[o]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Mr(t[n]/255)*255):t[n]=Mr(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},C0=0,Ya=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:C0++}),this.uuid=zn(),this.data=e,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push(gl(s[o].image)):r.push(gl(s[o]))}else r=gl(s);n.url=r}return t||(e.images[this.uuid]=n),n}};function gl(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?qa.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}var P0=0,nn=class i extends Ai{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=Cn,s=Cn,r=_n,o=Ki,a=Bn,c=Yi,l=i.DEFAULT_ANISOTROPY,h=kn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:P0++}),this.uuid=zn(),this.name="",this.source=new Ya(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=l,this.format=a,this.internalFormat=null,this.type=c,this.offset=new se(0,0),this.repeat=new se(1,1),this.center=new se(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new je,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,typeof h=="string"?this.colorSpace=h:(vo("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace=h===As?_t:kn),this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.needsPMREMUpdate=!1}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==up)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Ti:e.x=e.x-Math.floor(e.x);break;case Cn:e.x=e.x<0?0:1;break;case bo:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Ti:e.y=e.y-Math.floor(e.y);break;case Cn:e.y=e.y<0?0:1;break;case bo:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}get encoding(){return vo("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace===_t?As:vp}set encoding(e){vo("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace=e===As?_t:kn}};nn.DEFAULT_IMAGE=null;nn.DEFAULT_MAPPING=up;nn.DEFAULT_ANISOTROPY=1;var yt=class i{constructor(e=0,t=0,n=0,s=1){i.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*t+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*t+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*t+o[7]*n+o[11]*s+o[15]*r,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r,c=e.elements,l=c[0],h=c[4],u=c[8],d=c[1],f=c[5],m=c[9],_=c[2],g=c[6],p=c[10];if(Math.abs(h-d)<.01&&Math.abs(u-_)<.01&&Math.abs(m-g)<.01){if(Math.abs(h+d)<.1&&Math.abs(u+_)<.1&&Math.abs(m+g)<.1&&Math.abs(l+f+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let x=(l+1)/2,S=(f+1)/2,P=(p+1)/2,T=(h+d)/4,R=(u+_)/4,F=(m+g)/4;return x>S&&x>P?x<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(x),s=T/n,r=R/n):S>P?S<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(S),n=T/s,r=F/s):P<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(P),n=R/r,s=F/r),this.set(n,s,r,t),this}let v=Math.sqrt((g-m)*(g-m)+(u-_)*(u-_)+(d-h)*(d-h));return Math.abs(v)<.001&&(v=1),this.x=(g-m)/v,this.y=(u-_)/v,this.z=(d-h)/v,this.w=Math.acos((l+f+p-1)/2),this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},jl=class extends Ai{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new yt(0,0,e,t),this.scissorTest=!1,this.viewport=new yt(0,0,e,t);let s={width:e,height:t,depth:1};n.encoding!==void 0&&(vo("THREE.WebGLRenderTarget: option.encoding has been replaced by option.colorSpace."),n.colorSpace=n.encoding===As?_t:kn),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:_n,depthBuffer:!0,stencilBuffer:!1,depthTexture:null,samples:0},n),this.texture=new nn(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.flipY=!1,this.texture.generateMipmaps=n.generateMipmaps,this.texture.internalFormat=n.internalFormat,this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}setSize(e,t,n=1){(this.width!==e||this.height!==t||this.depth!==n)&&(this.width=e,this.height=t,this.depth=n,this.texture.image.width=e,this.texture.image.height=t,this.texture.image.depth=n,this.dispose()),this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.texture=e.texture.clone(),this.texture.isRenderTargetTexture=!0;let t=Object.assign({},e.texture.image);return this.texture.source=new Ya(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}},Ri=class extends jl{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},Za=class extends nn{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=zt,this.minFilter=zt,this.wrapR=Cn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Ql=class extends nn{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=zt,this.minFilter=zt,this.wrapR=Cn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var tn=class{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,o,a){let c=n[s+0],l=n[s+1],h=n[s+2],u=n[s+3],d=r[o+0],f=r[o+1],m=r[o+2],_=r[o+3];if(a===0){e[t+0]=c,e[t+1]=l,e[t+2]=h,e[t+3]=u;return}if(a===1){e[t+0]=d,e[t+1]=f,e[t+2]=m,e[t+3]=_;return}if(u!==_||c!==d||l!==f||h!==m){let g=1-a,p=c*d+l*f+h*m+u*_,v=p>=0?1:-1,x=1-p*p;if(x>Number.EPSILON){let P=Math.sqrt(x),T=Math.atan2(P,p*v);g=Math.sin(g*T)/P,a=Math.sin(a*T)/P}let S=a*v;if(c=c*g+d*S,l=l*g+f*S,h=h*g+m*S,u=u*g+_*S,g===1-a){let P=1/Math.sqrt(c*c+l*l+h*h+u*u);c*=P,l*=P,h*=P,u*=P}}e[t]=c,e[t+1]=l,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,s,r,o){let a=n[s],c=n[s+1],l=n[s+2],h=n[s+3],u=r[o],d=r[o+1],f=r[o+2],m=r[o+3];return e[t]=a*m+h*u+c*f-l*d,e[t+1]=c*m+h*d+l*u-a*f,e[t+2]=l*m+h*f+a*d-c*u,e[t+3]=h*m-a*u-c*d-l*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,s=e._y,r=e._z,o=e._order,a=Math.cos,c=Math.sin,l=a(n/2),h=a(s/2),u=a(r/2),d=c(n/2),f=c(s/2),m=c(r/2);switch(o){case"XYZ":this._x=d*h*u+l*f*m,this._y=l*f*u-d*h*m,this._z=l*h*m+d*f*u,this._w=l*h*u-d*f*m;break;case"YXZ":this._x=d*h*u+l*f*m,this._y=l*f*u-d*h*m,this._z=l*h*m-d*f*u,this._w=l*h*u+d*f*m;break;case"ZXY":this._x=d*h*u-l*f*m,this._y=l*f*u+d*h*m,this._z=l*h*m+d*f*u,this._w=l*h*u-d*f*m;break;case"ZYX":this._x=d*h*u-l*f*m,this._y=l*f*u+d*h*m,this._z=l*h*m-d*f*u,this._w=l*h*u+d*f*m;break;case"YZX":this._x=d*h*u+l*f*m,this._y=l*f*u+d*h*m,this._z=l*h*m-d*f*u,this._w=l*h*u-d*f*m;break;case"XZY":this._x=d*h*u-l*f*m,this._y=l*f*u-d*h*m,this._z=l*h*m+d*f*u,this._w=l*h*u+d*f*m;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],s=t[4],r=t[8],o=t[1],a=t[5],c=t[9],l=t[2],h=t[6],u=t[10],d=n+a+u;if(d>0){let f=.5/Math.sqrt(d+1);this._w=.25/f,this._x=(h-c)*f,this._y=(r-l)*f,this._z=(o-s)*f}else if(n>a&&n>u){let f=2*Math.sqrt(1+n-a-u);this._w=(h-c)/f,this._x=.25*f,this._y=(s+o)/f,this._z=(r+l)/f}else if(a>u){let f=2*Math.sqrt(1+a-n-u);this._w=(r-l)/f,this._x=(s+o)/f,this._y=.25*f,this._z=(c+h)/f}else{let f=2*Math.sqrt(1+u-n-a);this._w=(o-s)/f,this._x=(r+l)/f,this._y=(c+h)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs($t(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,s=e._y,r=e._z,o=e._w,a=t._x,c=t._y,l=t._z,h=t._w;return this._x=n*h+o*a+s*l-r*c,this._y=s*h+o*c+r*a-n*l,this._z=r*h+o*l+n*c-s*a,this._w=o*h-n*a-s*c-r*l,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);let n=this._x,s=this._y,r=this._z,o=this._w,a=o*e._w+n*e._x+s*e._y+r*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;let c=1-a*a;if(c<=Number.EPSILON){let f=1-t;return this._w=f*o+t*this._w,this._x=f*n+t*this._x,this._y=f*s+t*this._y,this._z=f*r+t*this._z,this.normalize(),this}let l=Math.sqrt(c),h=Math.atan2(l,a),u=Math.sin((1-t)*h)/l,d=Math.sin(t*h)/l;return this._w=o*u+this._w*d,this._x=n*u+this._x*d,this._y=s*u+this._y*d,this._z=r*u+this._z*d,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=Math.random(),t=Math.sqrt(1-e),n=Math.sqrt(e),s=2*Math.PI*Math.random(),r=2*Math.PI*Math.random();return this.set(t*Math.cos(s),n*Math.sin(r),n*Math.cos(r),t*Math.sin(s))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},A=class i{constructor(e=0,t=0,n=0){i.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(sf.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(sf.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=e.elements,o=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(e){let t=this.x,n=this.y,s=this.z,r=e.x,o=e.y,a=e.z,c=e.w,l=2*(o*s-a*n),h=2*(a*t-r*s),u=2*(r*n-o*t);return this.x=t+c*l+o*u-a*h,this.y=n+c*h+a*l-r*u,this.z=s+c*u+r*h-o*l,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,s=e.y,r=e.z,o=t.x,a=t.y,c=t.z;return this.x=s*c-r*a,this.y=r*o-n*c,this.z=n*a-s*o,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return _l.copy(this).projectOnVector(e),this.sub(_l)}reflect(e){return this.sub(_l.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos($t(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=(Math.random()-.5)*2,t=Math.random()*Math.PI*2,n=Math.sqrt(1-e**2);return this.x=n*Math.cos(t),this.y=n*Math.sin(t),this.z=e,this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},_l=new A,sf=new tn,hn=class{constructor(e=new A(1/0,1/0,1/0),t=new A(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(Kn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(Kn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=Kn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,Kn):Kn.fromBufferAttribute(r,o),Kn.applyMatrix4(e.matrixWorld),this.expandByPoint(Kn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),ra.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),ra.copy(n.boundingBox)),ra.applyMatrix4(e.matrixWorld),this.union(ra)}let s=e.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return!(e.x<this.min.x||e.x>this.max.x||e.y<this.min.y||e.y>this.max.y||e.z<this.min.z||e.z>this.max.z)}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return!(e.max.x<this.min.x||e.min.x>this.max.x||e.max.y<this.min.y||e.min.y>this.max.y||e.max.z<this.min.z||e.min.z>this.max.z)}intersectsSphere(e){return this.clampPoint(e.center,Kn),Kn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(ho),oa.subVectors(this.max,ho),Qs.subVectors(e.a,ho),er.subVectors(e.b,ho),tr.subVectors(e.c,ho),ki.subVectors(er,Qs),zi.subVectors(tr,er),_s.subVectors(Qs,tr);let t=[0,-ki.z,ki.y,0,-zi.z,zi.y,0,-_s.z,_s.y,ki.z,0,-ki.x,zi.z,0,-zi.x,_s.z,0,-_s.x,-ki.y,ki.x,0,-zi.y,zi.x,0,-_s.y,_s.x,0];return!xl(t,Qs,er,tr,oa)||(t=[1,0,0,0,1,0,0,0,1],!xl(t,Qs,er,tr,oa))?!1:(aa.crossVectors(ki,zi),t=[aa.x,aa.y,aa.z],xl(t,Qs,er,tr,oa))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Kn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Kn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(gi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),gi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),gi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),gi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),gi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),gi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),gi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),gi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(gi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}},gi=[new A,new A,new A,new A,new A,new A,new A,new A],Kn=new A,ra=new hn,Qs=new A,er=new A,tr=new A,ki=new A,zi=new A,_s=new A,ho=new A,oa=new A,aa=new A,xs=new A;function xl(i,e,t,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){xs.fromArray(i,r);let a=s.x*Math.abs(xs.x)+s.y*Math.abs(xs.y)+s.z*Math.abs(xs.z),c=e.dot(xs),l=t.dot(xs),h=n.dot(xs);if(Math.max(-Math.max(c,l,h),Math.min(c,l,h))>a)return!1}return!0}var L0=new hn,uo=new A,yl=new A,Pn=class{constructor(e=new A,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):L0.setFromPoints(e).getCenter(n);let s=0;for(let r=0,o=e.length;r<o;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;uo.subVectors(e,this.center);let t=uo.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(uo,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(yl.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(uo.copy(e.center).add(yl)),this.expandByPoint(uo.copy(e.center).sub(yl))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}},_i=new A,vl=new A,ca=new A,Hi=new A,Ml=new A,la=new A,Sl=new A,Cs=class{constructor(e=new A,t=new A(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,_i)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=_i.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(_i.copy(this.origin).addScaledVector(this.direction,t),_i.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){vl.copy(e).add(t).multiplyScalar(.5),ca.copy(t).sub(e).normalize(),Hi.copy(this.origin).sub(vl);let r=e.distanceTo(t)*.5,o=-this.direction.dot(ca),a=Hi.dot(this.direction),c=-Hi.dot(ca),l=Hi.lengthSq(),h=Math.abs(1-o*o),u,d,f,m;if(h>0)if(u=o*c-a,d=o*a-c,m=r*h,u>=0)if(d>=-m)if(d<=m){let _=1/h;u*=_,d*=_,f=u*(u+o*d+2*a)+d*(o*u+d+2*c)+l}else d=r,u=Math.max(0,-(o*d+a)),f=-u*u+d*(d+2*c)+l;else d=-r,u=Math.max(0,-(o*d+a)),f=-u*u+d*(d+2*c)+l;else d<=-m?(u=Math.max(0,-(-o*r+a)),d=u>0?-r:Math.min(Math.max(-r,-c),r),f=-u*u+d*(d+2*c)+l):d<=m?(u=0,d=Math.min(Math.max(-r,-c),r),f=d*(d+2*c)+l):(u=Math.max(0,-(o*r+a)),d=u>0?r:Math.min(Math.max(-r,-c),r),f=-u*u+d*(d+2*c)+l);else d=o>0?-r:r,u=Math.max(0,-(o*d+a)),f=-u*u+d*(d+2*c)+l;return n&&n.copy(this.origin).addScaledVector(this.direction,u),s&&s.copy(vl).addScaledVector(ca,d),f}intersectSphere(e,t){_i.subVectors(e.center,this.origin);let n=_i.dot(this.direction),s=_i.dot(_i)-n*n,r=e.radius*e.radius;if(s>r)return null;let o=Math.sqrt(r-s),a=n-o,c=n+o;return c<0?null:a<0?this.at(c,t):this.at(a,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,o,a,c,l=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,d=this.origin;return l>=0?(n=(e.min.x-d.x)*l,s=(e.max.x-d.x)*l):(n=(e.max.x-d.x)*l,s=(e.min.x-d.x)*l),h>=0?(r=(e.min.y-d.y)*h,o=(e.max.y-d.y)*h):(r=(e.max.y-d.y)*h,o=(e.min.y-d.y)*h),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),u>=0?(a=(e.min.z-d.z)*u,c=(e.max.z-d.z)*u):(a=(e.max.z-d.z)*u,c=(e.min.z-d.z)*u),n>c||a>s)||((a>n||n!==n)&&(n=a),(c<s||s!==s)&&(s=c),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,_i)!==null}intersectTriangle(e,t,n,s,r){Ml.subVectors(t,e),la.subVectors(n,e),Sl.crossVectors(Ml,la);let o=this.direction.dot(Sl),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Hi.subVectors(this.origin,e);let c=a*this.direction.dot(la.crossVectors(Hi,la));if(c<0)return null;let l=a*this.direction.dot(Ml.cross(Hi));if(l<0||c+l>o)return null;let h=-a*Hi.dot(Sl);return h<0?null:this.at(h/o,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},De=class i{constructor(e,t,n,s,r,o,a,c,l,h,u,d,f,m,_,g){i.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,c,l,h,u,d,f,m,_,g)}set(e,t,n,s,r,o,a,c,l,h,u,d,f,m,_,g){let p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=s,p[1]=r,p[5]=o,p[9]=a,p[13]=c,p[2]=l,p[6]=h,p[10]=u,p[14]=d,p[3]=f,p[7]=m,p[11]=_,p[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new i().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){let t=this.elements,n=e.elements,s=1/nr.setFromMatrixColumn(e,0).length(),r=1/nr.setFromMatrixColumn(e,1).length(),o=1/nr.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,s=e.y,r=e.z,o=Math.cos(n),a=Math.sin(n),c=Math.cos(s),l=Math.sin(s),h=Math.cos(r),u=Math.sin(r);if(e.order==="XYZ"){let d=o*h,f=o*u,m=a*h,_=a*u;t[0]=c*h,t[4]=-c*u,t[8]=l,t[1]=f+m*l,t[5]=d-_*l,t[9]=-a*c,t[2]=_-d*l,t[6]=m+f*l,t[10]=o*c}else if(e.order==="YXZ"){let d=c*h,f=c*u,m=l*h,_=l*u;t[0]=d+_*a,t[4]=m*a-f,t[8]=o*l,t[1]=o*u,t[5]=o*h,t[9]=-a,t[2]=f*a-m,t[6]=_+d*a,t[10]=o*c}else if(e.order==="ZXY"){let d=c*h,f=c*u,m=l*h,_=l*u;t[0]=d-_*a,t[4]=-o*u,t[8]=m+f*a,t[1]=f+m*a,t[5]=o*h,t[9]=_-d*a,t[2]=-o*l,t[6]=a,t[10]=o*c}else if(e.order==="ZYX"){let d=o*h,f=o*u,m=a*h,_=a*u;t[0]=c*h,t[4]=m*l-f,t[8]=d*l+_,t[1]=c*u,t[5]=_*l+d,t[9]=f*l-m,t[2]=-l,t[6]=a*c,t[10]=o*c}else if(e.order==="YZX"){let d=o*c,f=o*l,m=a*c,_=a*l;t[0]=c*h,t[4]=_-d*u,t[8]=m*u+f,t[1]=u,t[5]=o*h,t[9]=-a*h,t[2]=-l*h,t[6]=f*u+m,t[10]=d-_*u}else if(e.order==="XZY"){let d=o*c,f=o*l,m=a*c,_=a*l;t[0]=c*h,t[4]=-u,t[8]=l*h,t[1]=d*u+_,t[5]=o*h,t[9]=f*u-m,t[2]=m*u-f,t[6]=a*h,t[10]=_*u+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(I0,e,D0)}lookAt(e,t,n){let s=this.elements;return An.subVectors(e,t),An.lengthSq()===0&&(An.z=1),An.normalize(),Gi.crossVectors(n,An),Gi.lengthSq()===0&&(Math.abs(n.z)===1?An.x+=1e-4:An.z+=1e-4,An.normalize(),Gi.crossVectors(n,An)),Gi.normalize(),ha.crossVectors(An,Gi),s[0]=Gi.x,s[4]=ha.x,s[8]=An.x,s[1]=Gi.y,s[5]=ha.y,s[9]=An.y,s[2]=Gi.z,s[6]=ha.z,s[10]=An.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[4],c=n[8],l=n[12],h=n[1],u=n[5],d=n[9],f=n[13],m=n[2],_=n[6],g=n[10],p=n[14],v=n[3],x=n[7],S=n[11],P=n[15],T=s[0],R=s[4],F=s[8],M=s[12],w=s[1],U=s[5],q=s[9],re=s[13],I=s[2],O=s[6],H=s[10],K=s[14],Y=s[3],V=s[7],ee=s[11],te=s[15];return r[0]=o*T+a*w+c*I+l*Y,r[4]=o*R+a*U+c*O+l*V,r[8]=o*F+a*q+c*H+l*ee,r[12]=o*M+a*re+c*K+l*te,r[1]=h*T+u*w+d*I+f*Y,r[5]=h*R+u*U+d*O+f*V,r[9]=h*F+u*q+d*H+f*ee,r[13]=h*M+u*re+d*K+f*te,r[2]=m*T+_*w+g*I+p*Y,r[6]=m*R+_*U+g*O+p*V,r[10]=m*F+_*q+g*H+p*ee,r[14]=m*M+_*re+g*K+p*te,r[3]=v*T+x*w+S*I+P*Y,r[7]=v*R+x*U+S*O+P*V,r[11]=v*F+x*q+S*H+P*ee,r[15]=v*M+x*re+S*K+P*te,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],o=e[1],a=e[5],c=e[9],l=e[13],h=e[2],u=e[6],d=e[10],f=e[14],m=e[3],_=e[7],g=e[11],p=e[15];return m*(+r*c*u-s*l*u-r*a*d+n*l*d+s*a*f-n*c*f)+_*(+t*c*f-t*l*d+r*o*d-s*o*f+s*l*h-r*c*h)+g*(+t*l*u-t*a*f-r*o*u+n*o*f+r*a*h-n*l*h)+p*(-s*a*h-t*c*u+t*a*d+s*o*u-n*o*d+n*c*h)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],c=e[6],l=e[7],h=e[8],u=e[9],d=e[10],f=e[11],m=e[12],_=e[13],g=e[14],p=e[15],v=u*g*l-_*d*l+_*c*f-a*g*f-u*c*p+a*d*p,x=m*d*l-h*g*l-m*c*f+o*g*f+h*c*p-o*d*p,S=h*_*l-m*u*l+m*a*f-o*_*f-h*a*p+o*u*p,P=m*u*c-h*_*c-m*a*d+o*_*d+h*a*g-o*u*g,T=t*v+n*x+s*S+r*P;if(T===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let R=1/T;return e[0]=v*R,e[1]=(_*d*r-u*g*r-_*s*f+n*g*f+u*s*p-n*d*p)*R,e[2]=(a*g*r-_*c*r+_*s*l-n*g*l-a*s*p+n*c*p)*R,e[3]=(u*c*r-a*d*r-u*s*l+n*d*l+a*s*f-n*c*f)*R,e[4]=x*R,e[5]=(h*g*r-m*d*r+m*s*f-t*g*f-h*s*p+t*d*p)*R,e[6]=(m*c*r-o*g*r-m*s*l+t*g*l+o*s*p-t*c*p)*R,e[7]=(o*d*r-h*c*r+h*s*l-t*d*l-o*s*f+t*c*f)*R,e[8]=S*R,e[9]=(m*u*r-h*_*r-m*n*f+t*_*f+h*n*p-t*u*p)*R,e[10]=(o*_*r-m*a*r+m*n*l-t*_*l-o*n*p+t*a*p)*R,e[11]=(h*a*r-o*u*r-h*n*l+t*u*l+o*n*f-t*a*f)*R,e[12]=P*R,e[13]=(h*_*s-m*u*s+m*n*d-t*_*d-h*n*g+t*u*g)*R,e[14]=(m*a*s-o*_*s-m*n*c+t*_*c+o*n*g-t*a*g)*R,e[15]=(o*u*s-h*a*s+h*n*c-t*u*c-o*n*d+t*a*d)*R,this}scale(e){let t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),s=Math.sin(t),r=1-n,o=e.x,a=e.y,c=e.z,l=r*o,h=r*a;return this.set(l*o+n,l*a-s*c,l*c+s*a,0,l*a+s*c,h*a+n,h*c-s*o,0,l*c-s*a,h*c+s*o,r*c*c+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,o){return this.set(1,n,r,0,e,1,o,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){let s=this.elements,r=t._x,o=t._y,a=t._z,c=t._w,l=r+r,h=o+o,u=a+a,d=r*l,f=r*h,m=r*u,_=o*h,g=o*u,p=a*u,v=c*l,x=c*h,S=c*u,P=n.x,T=n.y,R=n.z;return s[0]=(1-(_+p))*P,s[1]=(f+S)*P,s[2]=(m-x)*P,s[3]=0,s[4]=(f-S)*T,s[5]=(1-(d+p))*T,s[6]=(g+v)*T,s[7]=0,s[8]=(m+x)*R,s[9]=(g-v)*R,s[10]=(1-(d+_))*R,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){let s=this.elements,r=nr.set(s[0],s[1],s[2]).length(),o=nr.set(s[4],s[5],s[6]).length(),a=nr.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],$n.copy(this);let l=1/r,h=1/o,u=1/a;return $n.elements[0]*=l,$n.elements[1]*=l,$n.elements[2]*=l,$n.elements[4]*=h,$n.elements[5]*=h,$n.elements[6]*=h,$n.elements[8]*=u,$n.elements[9]*=u,$n.elements[10]*=u,t.setFromRotationMatrix($n),n.x=r,n.y=o,n.z=a,this}makePerspective(e,t,n,s,r,o,a=wi){let c=this.elements,l=2*r/(t-e),h=2*r/(n-s),u=(t+e)/(t-e),d=(n+s)/(n-s),f,m;if(a===wi)f=-(o+r)/(o-r),m=-2*o*r/(o-r);else if(a===Wa)f=-o/(o-r),m=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=l,c[4]=0,c[8]=u,c[12]=0,c[1]=0,c[5]=h,c[9]=d,c[13]=0,c[2]=0,c[6]=0,c[10]=f,c[14]=m,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,s,r,o,a=wi){let c=this.elements,l=1/(t-e),h=1/(n-s),u=1/(o-r),d=(t+e)*l,f=(n+s)*h,m,_;if(a===wi)m=(o+r)*u,_=-2*u;else if(a===Wa)m=r*u,_=-1*u;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=2*l,c[4]=0,c[8]=0,c[12]=-d,c[1]=0,c[5]=2*h,c[9]=0,c[13]=-f,c[2]=0,c[6]=0,c[10]=_,c[14]=-m,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},nr=new A,$n=new De,I0=new A(0,0,0),D0=new A(1,1,1),Gi=new A,ha=new A,An=new A,rf=new De,of=new tn,Rr=class i{constructor(e=0,t=0,n=0,s=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let s=e.elements,r=s[0],o=s[4],a=s[8],c=s[1],l=s[5],h=s[9],u=s[2],d=s[6],f=s[10];switch(t){case"XYZ":this._y=Math.asin($t(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-h,f),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(d,l),this._z=0);break;case"YXZ":this._x=Math.asin(-$t(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(a,f),this._z=Math.atan2(c,l)):(this._y=Math.atan2(-u,r),this._z=0);break;case"ZXY":this._x=Math.asin($t(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-o,l)):(this._y=0,this._z=Math.atan2(c,r));break;case"ZYX":this._y=Math.asin(-$t(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(c,r)):(this._x=0,this._z=Math.atan2(-o,l));break;case"YZX":this._z=Math.asin($t(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(-h,l),this._y=Math.atan2(-u,r)):(this._x=0,this._y=Math.atan2(a,f));break;case"XZY":this._z=Math.asin(-$t(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(d,l),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-h,f),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return rf.makeRotationFromQuaternion(e),this.setFromRotationMatrix(rf,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return of.setFromEuler(this),this.setFromQuaternion(of,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Rr.DEFAULT_ORDER="XYZ";var Ao=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},N0=0,af=new A,ir=new tn,xi=new De,ua=new A,fo=new A,U0=new A,O0=new tn,cf=new A(1,0,0),lf=new A(0,1,0),hf=new A(0,0,1),F0={type:"added"},B0={type:"removed"},Tt=class i extends Ai{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:N0++}),this.uuid=zn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new A,t=new Rr,n=new tn,s=new A(1,1,1);function r(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new De},normalMatrix:{value:new je}}),this.matrix=new De,this.matrixWorld=new De,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Ao,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return ir.setFromAxisAngle(e,t),this.quaternion.multiply(ir),this}rotateOnWorldAxis(e,t){return ir.setFromAxisAngle(e,t),this.quaternion.premultiply(ir),this}rotateX(e){return this.rotateOnAxis(cf,e)}rotateY(e){return this.rotateOnAxis(lf,e)}rotateZ(e){return this.rotateOnAxis(hf,e)}translateOnAxis(e,t){return af.copy(e).applyQuaternion(this.quaternion),this.position.add(af.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(cf,e)}translateY(e){return this.translateOnAxis(lf,e)}translateZ(e){return this.translateOnAxis(hf,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(xi.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?ua.copy(e):ua.set(e,t,n);let s=this.parent;this.updateWorldMatrix(!0,!1),fo.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?xi.lookAt(fo,ua,this.up):xi.lookAt(ua,fo,this.up),this.quaternion.setFromRotationMatrix(xi),s&&(xi.extractRotation(s.matrixWorld),ir.setFromRotationMatrix(xi),this.quaternion.premultiply(ir.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.parent!==null&&e.parent.remove(e),e.parent=this,this.children.push(e),e.dispatchEvent(F0)):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(B0)),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),xi.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),xi.multiply(e.parent.matrixWorld)),e.applyMatrix4(xi),this.add(e),e.updateWorldMatrix(!1,!0),this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){let o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(fo,e,U0),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(fo,O0,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,s=t.length;n<s;n++){let r=t[n];(r.matrixWorldAutoUpdate===!0||e===!0)&&r.updateMatrixWorld(e)}}updateWorldMatrix(e,t){let n=this.parent;if(e===!0&&n!==null&&n.matrixWorldAutoUpdate===!0&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),t===!0){let s=this.children;for(let r=0,o=s.length;r<o;r++){let a=s[r];a.matrixWorldAutoUpdate===!0&&a.updateWorldMatrix(!1,!0)}}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.visibility=this._visibility,s.active=this._active,s.bounds=this._bounds.map(a=>({boxInitialized:a.boxInitialized,boxMin:a.box.min.toArray(),boxMax:a.box.max.toArray(),sphereInitialized:a.sphereInitialized,sphereRadius:a.sphere.radius,sphereCenter:a.sphere.center.toArray()})),s.maxGeometryCount=this._maxGeometryCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.geometryCount=this._geometryCount,s.matricesTexture=this._matricesTexture.toJSON(e),this.boundingSphere!==null&&(s.boundingSphere={center:s.boundingSphere.center.toArray(),radius:s.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:s.boundingBox.min.toArray(),max:s.boundingBox.max.toArray()}));function r(a,c){return a[c.uuid]===void 0&&(a[c.uuid]=c.toJSON(e)),c.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let c=a.shapes;if(Array.isArray(c))for(let l=0,h=c.length;l<h;l++){let u=c[l];r(e.shapes,u)}else r(e.shapes,c)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let c=0,l=this.material.length;c<l;c++)a.push(r(e.materials,this.material[c]));s.material=a}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){let c=this.animations[a];s.animations.push(r(e.animations,c))}}if(t){let a=o(e.geometries),c=o(e.materials),l=o(e.textures),h=o(e.images),u=o(e.shapes),d=o(e.skeletons),f=o(e.animations),m=o(e.nodes);a.length>0&&(n.geometries=a),c.length>0&&(n.materials=c),l.length>0&&(n.textures=l),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),d.length>0&&(n.skeletons=d),f.length>0&&(n.animations=f),m.length>0&&(n.nodes=m)}return n.object=s,n;function o(a){let c=[];for(let l in a){let h=a[l];delete h.metadata,c.push(h)}return c}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let s=e.children[n];this.add(s.clone())}return this}};Tt.DEFAULT_UP=new A(0,1,0);Tt.DEFAULT_MATRIX_AUTO_UPDATE=!0;Tt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Jn=new A,yi=new A,El=new A,vi=new A,sr=new A,rr=new A,uf=new A,bl=new A,wl=new A,Tl=new A,da=!1,bs=class i{constructor(e=new A,t=new A,n=new A){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),Jn.subVectors(e,t),s.cross(Jn);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){Jn.subVectors(s,t),yi.subVectors(n,t),El.subVectors(e,t);let o=Jn.dot(Jn),a=Jn.dot(yi),c=Jn.dot(El),l=yi.dot(yi),h=yi.dot(El),u=o*l-a*a;if(u===0)return r.set(0,0,0),null;let d=1/u,f=(l*c-a*h)*d,m=(o*h-a*c)*d;return r.set(1-f-m,m,f)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,vi)===null?!1:vi.x>=0&&vi.y>=0&&vi.x+vi.y<=1}static getUV(e,t,n,s,r,o,a,c){return da===!1&&(console.warn("THREE.Triangle.getUV() has been renamed to THREE.Triangle.getInterpolation()."),da=!0),this.getInterpolation(e,t,n,s,r,o,a,c)}static getInterpolation(e,t,n,s,r,o,a,c){return this.getBarycoord(e,t,n,s,vi)===null?(c.x=0,c.y=0,"z"in c&&(c.z=0),"w"in c&&(c.w=0),null):(c.setScalar(0),c.addScaledVector(r,vi.x),c.addScaledVector(o,vi.y),c.addScaledVector(a,vi.z),c)}static isFrontFacing(e,t,n,s){return Jn.subVectors(n,t),yi.subVectors(e,t),Jn.cross(yi).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Jn.subVectors(this.c,this.b),yi.subVectors(this.a,this.b),Jn.cross(yi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getUV(e,t,n,s,r){return da===!1&&(console.warn("THREE.Triangle.getUV() has been renamed to THREE.Triangle.getInterpolation()."),da=!0),i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}getInterpolation(e,t,n,s,r){return i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,s=this.b,r=this.c,o,a;sr.subVectors(s,n),rr.subVectors(r,n),bl.subVectors(e,n);let c=sr.dot(bl),l=rr.dot(bl);if(c<=0&&l<=0)return t.copy(n);wl.subVectors(e,s);let h=sr.dot(wl),u=rr.dot(wl);if(h>=0&&u<=h)return t.copy(s);let d=c*u-h*l;if(d<=0&&c>=0&&h<=0)return o=c/(c-h),t.copy(n).addScaledVector(sr,o);Tl.subVectors(e,r);let f=sr.dot(Tl),m=rr.dot(Tl);if(m>=0&&f<=m)return t.copy(r);let _=f*l-c*m;if(_<=0&&l>=0&&m<=0)return a=l/(l-m),t.copy(n).addScaledVector(rr,a);let g=h*m-f*u;if(g<=0&&u-h>=0&&f-m>=0)return uf.subVectors(r,s),a=(u-h)/(u-h+(f-m)),t.copy(s).addScaledVector(uf,a);let p=1/(g+_+d);return o=_*p,a=d*p,t.copy(n).addScaledVector(sr,o).addScaledVector(rr,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},bp={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Vi={h:0,s:0,l:0},fa={h:0,s:0,l:0};function Al(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}var Ee=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=_t){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,ft.toWorkingColorSpace(this,t),this}setRGB(e,t,n,s=ft.workingColorSpace){return this.r=e,this.g=t,this.b=n,ft.toWorkingColorSpace(this,s),this}setHSL(e,t,n,s=ft.workingColorSpace){if(e=Hh(e,1),t=$t(t,0,1),n=$t(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,o=2*n-r;this.r=Al(o,r,e+1/3),this.g=Al(o,r,e),this.b=Al(o,r,e-1/3)}return ft.toWorkingColorSpace(this,s),this}setStyle(e,t=_t){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=_t){let n=bp[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Mr(e.r),this.g=Mr(e.g),this.b=Mr(e.b),this}copyLinearToSRGB(e){return this.r=ml(e.r),this.g=ml(e.g),this.b=ml(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=_t){return ft.fromWorkingColorSpace(ln.copy(this),e),Math.round($t(ln.r*255,0,255))*65536+Math.round($t(ln.g*255,0,255))*256+Math.round($t(ln.b*255,0,255))}getHexString(e=_t){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=ft.workingColorSpace){ft.fromWorkingColorSpace(ln.copy(this),t);let n=ln.r,s=ln.g,r=ln.b,o=Math.max(n,s,r),a=Math.min(n,s,r),c,l,h=(a+o)/2;if(a===o)c=0,l=0;else{let u=o-a;switch(l=h<=.5?u/(o+a):u/(2-o-a),o){case n:c=(s-r)/u+(s<r?6:0);break;case s:c=(r-n)/u+2;break;case r:c=(n-s)/u+4;break}c/=6}return e.h=c,e.s=l,e.l=h,e}getRGB(e,t=ft.workingColorSpace){return ft.fromWorkingColorSpace(ln.copy(this),t),e.r=ln.r,e.g=ln.g,e.b=ln.b,e}getStyle(e=_t){ft.fromWorkingColorSpace(ln.copy(this),e);let t=ln.r,n=ln.g,s=ln.b;return e!==_t?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Vi),this.setHSL(Vi.h+e,Vi.s+t,Vi.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Vi),e.getHSL(fa);let n=yo(Vi.h,fa.h,t),s=yo(Vi.s,fa.s,t),r=yo(Vi.l,fa.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},ln=new Ee;Ee.NAMES=bp;var k0=0,Ln=class extends Ai{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:k0++}),this.uuid=zn(),this.name="",this.type="Material",this.blending=yr,this.side=oi,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Xl,this.blendDst=ql,this.blendEquation=Ss,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ee(0,0,0),this.blendAlpha=0,this.depthFunc=Ba,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Jd,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Js,this.stencilZFail=Js,this.stencilZPass=Js,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBuild(){}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==yr&&(n.blending=this.blending),this.side!==oi&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Xl&&(n.blendSrc=this.blendSrc),this.blendDst!==ql&&(n.blendDst=this.blendDst),this.blendEquation!==Ss&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Ba&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Jd&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Js&&(n.stencilFail=this.stencilFail),this.stencilZFail!==Js&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==Js&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){let o=[];for(let a in r){let c=r[a];delete c.metadata,o.push(c)}return o}if(t){let r=s(e.textures),o=s(e.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},rt=class extends Ln{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ee(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.combine=hp,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}};var Bt=new A,pa=new se,Ot=class{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=Kl,this._updateRange={offset:0,count:-1},this.updateRanges=[],this.gpuType=bi,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}get updateRange(){return console.warn("THREE.BufferAttribute: updateRange() is deprecated and will be removed in r169. Use addUpdateRange() instead."),this._updateRange}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)pa.fromBufferAttribute(this,t),pa.applyMatrix3(e),this.setXY(t,pa.x,pa.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)Bt.fromBufferAttribute(this,t),Bt.applyMatrix3(e),this.setXYZ(t,Bt.x,Bt.y,Bt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)Bt.fromBufferAttribute(this,t),Bt.applyMatrix4(e),this.setXYZ(t,Bt.x,Bt.y,Bt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Bt.fromBufferAttribute(this,t),Bt.applyNormalMatrix(e),this.setXYZ(t,Bt.x,Bt.y,Bt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Bt.fromBufferAttribute(this,t),Bt.transformDirection(e),this.setXYZ(t,Bt.x,Bt.y,Bt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=si(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=gt(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=si(t,this.array)),t}setX(e,t){return this.normalized&&(t=gt(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=si(t,this.array)),t}setY(e,t){return this.normalized&&(t=gt(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=si(t,this.array)),t}setZ(e,t){return this.normalized&&(t=gt(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=si(t,this.array)),t}setW(e,t){return this.normalized&&(t=gt(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=gt(t,this.array),n=gt(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=gt(t,this.array),n=gt(n,this.array),s=gt(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=gt(t,this.array),n=gt(n,this.array),s=gt(s,this.array),r=gt(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Kl&&(e.usage=this.usage),e}};var Ka=class extends Ot{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var $a=class extends Ot{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var lt=class extends Ot{constructor(e,t,n){super(new Float32Array(e),t,n)}};var z0=0,Fn=new De,Rl=new Tt,or=new A,Rn=new hn,po=new hn,Kt=new A,Lt=class i extends Ai{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:z0++}),this.uuid=zn(),this.name="",this.type="BufferGeometry",this.index=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Ep(e)?$a:Ka)(e,1):this.index=e,this}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new je().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Fn.makeRotationFromQuaternion(e),this.applyMatrix4(Fn),this}rotateX(e){return Fn.makeRotationX(e),this.applyMatrix4(Fn),this}rotateY(e){return Fn.makeRotationY(e),this.applyMatrix4(Fn),this}rotateZ(e){return Fn.makeRotationZ(e),this.applyMatrix4(Fn),this}translate(e,t,n){return Fn.makeTranslation(e,t,n),this.applyMatrix4(Fn),this}scale(e,t,n){return Fn.makeScale(e,t,n),this.applyMatrix4(Fn),this}lookAt(e){return Rl.lookAt(e),Rl.updateMatrix(),this.applyMatrix4(Rl.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(or).negate(),this.translate(or.x,or.y,or.z),this}setFromPoints(e){let t=[];for(let n=0,s=e.length;n<s;n++){let r=e[n];t.push(r.x,r.y,r.z||0)}return this.setAttribute("position",new lt(t,3)),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new hn);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error('THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box. Alternatively set "mesh.frustumCulled" to "false".',this),this.boundingBox.set(new A(-1/0,-1/0,-1/0),new A(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){let r=t[n];Rn.setFromBufferAttribute(r),this.morphTargetsRelative?(Kt.addVectors(this.boundingBox.min,Rn.min),this.boundingBox.expandByPoint(Kt),Kt.addVectors(this.boundingBox.max,Rn.max),this.boundingBox.expandByPoint(Kt)):(this.boundingBox.expandByPoint(Rn.min),this.boundingBox.expandByPoint(Rn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Pn);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error('THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere. Alternatively set "mesh.frustumCulled" to "false".',this),this.boundingSphere.set(new A,1/0);return}if(e){let n=this.boundingSphere.center;if(Rn.setFromBufferAttribute(e),t)for(let r=0,o=t.length;r<o;r++){let a=t[r];po.setFromBufferAttribute(a),this.morphTargetsRelative?(Kt.addVectors(Rn.min,po.min),Rn.expandByPoint(Kt),Kt.addVectors(Rn.max,po.max),Rn.expandByPoint(Kt)):(Rn.expandByPoint(po.min),Rn.expandByPoint(po.max))}Rn.getCenter(n);let s=0;for(let r=0,o=e.count;r<o;r++)Kt.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(Kt));if(t)for(let r=0,o=t.length;r<o;r++){let a=t[r],c=this.morphTargetsRelative;for(let l=0,h=a.count;l<h;l++)Kt.fromBufferAttribute(a,l),c&&(or.fromBufferAttribute(e,l),Kt.add(or)),s=Math.max(s,n.distanceToSquared(Kt))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=e.array,s=t.position.array,r=t.normal.array,o=t.uv.array,a=s.length/3;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Ot(new Float32Array(4*a),4));let c=this.getAttribute("tangent").array,l=[],h=[];for(let w=0;w<a;w++)l[w]=new A,h[w]=new A;let u=new A,d=new A,f=new A,m=new se,_=new se,g=new se,p=new A,v=new A;function x(w,U,q){u.fromArray(s,w*3),d.fromArray(s,U*3),f.fromArray(s,q*3),m.fromArray(o,w*2),_.fromArray(o,U*2),g.fromArray(o,q*2),d.sub(u),f.sub(u),_.sub(m),g.sub(m);let re=1/(_.x*g.y-g.x*_.y);isFinite(re)&&(p.copy(d).multiplyScalar(g.y).addScaledVector(f,-_.y).multiplyScalar(re),v.copy(f).multiplyScalar(_.x).addScaledVector(d,-g.x).multiplyScalar(re),l[w].add(p),l[U].add(p),l[q].add(p),h[w].add(v),h[U].add(v),h[q].add(v))}let S=this.groups;S.length===0&&(S=[{start:0,count:n.length}]);for(let w=0,U=S.length;w<U;++w){let q=S[w],re=q.start,I=q.count;for(let O=re,H=re+I;O<H;O+=3)x(n[O+0],n[O+1],n[O+2])}let P=new A,T=new A,R=new A,F=new A;function M(w){R.fromArray(r,w*3),F.copy(R);let U=l[w];P.copy(U),P.sub(R.multiplyScalar(R.dot(U))).normalize(),T.crossVectors(F,U);let re=T.dot(h[w])<0?-1:1;c[w*4]=P.x,c[w*4+1]=P.y,c[w*4+2]=P.z,c[w*4+3]=re}for(let w=0,U=S.length;w<U;++w){let q=S[w],re=q.start,I=q.count;for(let O=re,H=re+I;O<H;O+=3)M(n[O+0]),M(n[O+1]),M(n[O+2])}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new Ot(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,f=n.count;d<f;d++)n.setXYZ(d,0,0,0);let s=new A,r=new A,o=new A,a=new A,c=new A,l=new A,h=new A,u=new A;if(e)for(let d=0,f=e.count;d<f;d+=3){let m=e.getX(d+0),_=e.getX(d+1),g=e.getX(d+2);s.fromBufferAttribute(t,m),r.fromBufferAttribute(t,_),o.fromBufferAttribute(t,g),h.subVectors(o,r),u.subVectors(s,r),h.cross(u),a.fromBufferAttribute(n,m),c.fromBufferAttribute(n,_),l.fromBufferAttribute(n,g),a.add(h),c.add(h),l.add(h),n.setXYZ(m,a.x,a.y,a.z),n.setXYZ(_,c.x,c.y,c.z),n.setXYZ(g,l.x,l.y,l.z)}else for(let d=0,f=t.count;d<f;d+=3)s.fromBufferAttribute(t,d+0),r.fromBufferAttribute(t,d+1),o.fromBufferAttribute(t,d+2),h.subVectors(o,r),u.subVectors(s,r),h.cross(u),n.setXYZ(d+0,h.x,h.y,h.z),n.setXYZ(d+1,h.x,h.y,h.z),n.setXYZ(d+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Kt.fromBufferAttribute(e,t),Kt.normalize(),e.setXYZ(t,Kt.x,Kt.y,Kt.z)}toNonIndexed(){function e(a,c){let l=a.array,h=a.itemSize,u=a.normalized,d=new l.constructor(c.length*h),f=0,m=0;for(let _=0,g=c.length;_<g;_++){a.isInterleavedBufferAttribute?f=c[_]*a.data.stride+a.offset:f=c[_]*h;for(let p=0;p<h;p++)d[m++]=l[f++]}return new Ot(d,h,u)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,s=this.attributes;for(let a in s){let c=s[a],l=e(c,n);t.setAttribute(a,l)}let r=this.morphAttributes;for(let a in r){let c=[],l=r[a];for(let h=0,u=l.length;h<u;h++){let d=l[h],f=e(d,n);c.push(f)}t.morphAttributes[a]=c}t.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,c=o.length;a<c;a++){let l=o[a];t.addGroup(l.start,l.count,l.materialIndex)}return t}toJSON(){let e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let c=this.parameters;for(let l in c)c[l]!==void 0&&(e[l]=c[l]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let c in n){let l=n[c];e.data.attributes[c]=l.toJSON(e.data)}let s={},r=!1;for(let c in this.morphAttributes){let l=this.morphAttributes[c],h=[];for(let u=0,d=l.length;u<d;u++){let f=l[u];h.push(f.toJSON(e.data))}h.length>0&&(s[c]=h,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone(t));let s=e.attributes;for(let l in s){let h=s[l];this.setAttribute(l,h.clone(t))}let r=e.morphAttributes;for(let l in r){let h=[],u=r[l];for(let d=0,f=u.length;d<f;d++)h.push(u[d].clone(t));this.morphAttributes[l]=h}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let l=0,h=o.length;l<h;l++){let u=o[l];this.addGroup(u.start,u.count,u.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let c=e.boundingSphere;return c!==null&&(this.boundingSphere=c.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},df=new De,ys=new Cs,ma=new Pn,ff=new A,ar=new A,cr=new A,lr=new A,Cl=new A,ga=new A,_a=new se,xa=new se,ya=new se,pf=new A,mf=new A,gf=new A,va=new A,Ma=new A,ae=class extends Tt{constructor(e=new Lt,t=new rt){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){let a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(e,t){let n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(s,e);let a=this.morphTargetInfluences;if(r&&a){ga.set(0,0,0);for(let c=0,l=r.length;c<l;c++){let h=a[c],u=r[c];h!==0&&(Cl.fromBufferAttribute(u,e),o?ga.addScaledVector(Cl,h):ga.addScaledVector(Cl.sub(t),h))}t.add(ga)}return t}raycast(e,t){let n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),ma.copy(n.boundingSphere),ma.applyMatrix4(r),ys.copy(e.ray).recast(e.near),!(ma.containsPoint(ys.origin)===!1&&(ys.intersectSphere(ma,ff)===null||ys.origin.distanceToSquared(ff)>(e.far-e.near)**2))&&(df.copy(r).invert(),ys.copy(e.ray).applyMatrix4(df),!(n.boundingBox!==null&&ys.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,ys)))}_computeIntersections(e,t,n){let s,r=this.geometry,o=this.material,a=r.index,c=r.attributes.position,l=r.attributes.uv,h=r.attributes.uv1,u=r.attributes.normal,d=r.groups,f=r.drawRange;if(a!==null)if(Array.isArray(o))for(let m=0,_=d.length;m<_;m++){let g=d[m],p=o[g.materialIndex],v=Math.max(g.start,f.start),x=Math.min(a.count,Math.min(g.start+g.count,f.start+f.count));for(let S=v,P=x;S<P;S+=3){let T=a.getX(S),R=a.getX(S+1),F=a.getX(S+2);s=Sa(this,p,e,n,l,h,u,T,R,F),s&&(s.faceIndex=Math.floor(S/3),s.face.materialIndex=g.materialIndex,t.push(s))}}else{let m=Math.max(0,f.start),_=Math.min(a.count,f.start+f.count);for(let g=m,p=_;g<p;g+=3){let v=a.getX(g),x=a.getX(g+1),S=a.getX(g+2);s=Sa(this,o,e,n,l,h,u,v,x,S),s&&(s.faceIndex=Math.floor(g/3),t.push(s))}}else if(c!==void 0)if(Array.isArray(o))for(let m=0,_=d.length;m<_;m++){let g=d[m],p=o[g.materialIndex],v=Math.max(g.start,f.start),x=Math.min(c.count,Math.min(g.start+g.count,f.start+f.count));for(let S=v,P=x;S<P;S+=3){let T=S,R=S+1,F=S+2;s=Sa(this,p,e,n,l,h,u,T,R,F),s&&(s.faceIndex=Math.floor(S/3),s.face.materialIndex=g.materialIndex,t.push(s))}}else{let m=Math.max(0,f.start),_=Math.min(c.count,f.start+f.count);for(let g=m,p=_;g<p;g+=3){let v=g,x=g+1,S=g+2;s=Sa(this,o,e,n,l,h,u,v,x,S),s&&(s.faceIndex=Math.floor(g/3),t.push(s))}}}};function H0(i,e,t,n,s,r,o,a){let c;if(e.side===Mn?c=n.intersectTriangle(o,r,s,!0,a):c=n.intersectTriangle(s,r,o,e.side===oi,a),c===null)return null;Ma.copy(a),Ma.applyMatrix4(i.matrixWorld);let l=t.ray.origin.distanceTo(Ma);return l<t.near||l>t.far?null:{distance:l,point:Ma.clone(),object:i}}function Sa(i,e,t,n,s,r,o,a,c,l){i.getVertexPosition(a,ar),i.getVertexPosition(c,cr),i.getVertexPosition(l,lr);let h=H0(i,e,t,n,ar,cr,lr,va);if(h){s&&(_a.fromBufferAttribute(s,a),xa.fromBufferAttribute(s,c),ya.fromBufferAttribute(s,l),h.uv=bs.getInterpolation(va,ar,cr,lr,_a,xa,ya,new se)),r&&(_a.fromBufferAttribute(r,a),xa.fromBufferAttribute(r,c),ya.fromBufferAttribute(r,l),h.uv1=bs.getInterpolation(va,ar,cr,lr,_a,xa,ya,new se),h.uv2=h.uv1),o&&(pf.fromBufferAttribute(o,a),mf.fromBufferAttribute(o,c),gf.fromBufferAttribute(o,l),h.normal=bs.getInterpolation(va,ar,cr,lr,pf,mf,gf,new A),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let u={a,b:c,c:l,normal:new A,materialIndex:0};bs.getNormal(ar,cr,lr,u.normal),h.face=u}return h}var ut=class i extends Lt{constructor(e=1,t=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};let a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);let c=[],l=[],h=[],u=[],d=0,f=0;m("z","y","x",-1,-1,n,t,e,o,r,0),m("z","y","x",1,-1,n,t,-e,o,r,1),m("x","z","y",1,1,e,n,t,s,o,2),m("x","z","y",1,-1,e,n,-t,s,o,3),m("x","y","z",1,-1,e,t,n,s,r,4),m("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(c),this.setAttribute("position",new lt(l,3)),this.setAttribute("normal",new lt(h,3)),this.setAttribute("uv",new lt(u,2));function m(_,g,p,v,x,S,P,T,R,F,M){let w=S/R,U=P/F,q=S/2,re=P/2,I=T/2,O=R+1,H=F+1,K=0,Y=0,V=new A;for(let ee=0;ee<H;ee++){let te=ee*U-re;for(let me=0;me<O;me++){let G=me*w-q;V[_]=G*v,V[g]=te*x,V[p]=I,l.push(V.x,V.y,V.z),V[_]=0,V[g]=0,V[p]=T>0?1:-1,h.push(V.x,V.y,V.z),u.push(me/R),u.push(1-ee/F),K+=1}}for(let ee=0;ee<F;ee++)for(let te=0;te<R;te++){let me=d+te+O*ee,G=d+te+O*(ee+1),J=d+(te+1)+O*(ee+1),ge=d+(te+1)+O*ee;c.push(me,G,ge),c.push(G,J,ge),Y+=6}a.addGroup(f,Y,M),f+=Y,d+=K}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};function Cr(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function gn(i){let e={};for(let t=0;t<i.length;t++){let n=Cr(i[t]);for(let s in n)e[s]=n[s]}return e}function G0(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function wp(i){return i.getRenderTarget()===null?i.outputColorSpace:ft.workingColorSpace}var V0={clone:Cr,merge:gn},W0=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,X0=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Ci=class extends Ln{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=W0,this.fragmentShader=X0,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={derivatives:!1,fragDepth:!1,drawBuffers:!1,shaderTextureLOD:!1,clipCullDistance:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Cr(e.uniforms),this.uniformsGroups=G0(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let s in this.uniforms){let o=this.uniforms[s].value;o&&o.isTexture?t.uniforms[s]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[s]={type:"m4",value:o.toArray()}:t.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}},Ja=class extends Tt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new De,this.projectionMatrix=new De,this.projectionMatrixInverse=new De,this.coordinateSystem=wi}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},en=class extends Ja{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=Ar*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(vr*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Ar*2*Math.atan(Math.tan(vr*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}setViewOffset(e,t,n,s,r,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(vr*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s,o=this.view;if(this.view!==null&&this.view.enabled){let c=o.fullWidth,l=o.fullHeight;r+=o.offsetX*s/c,t-=o.offsetY*n/l,s*=o.width/c,n*=o.height/l}let a=this.filmOffset;a!==0&&(r+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},hr=-90,ur=1,eh=class extends Tt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new en(hr,ur,e,t);s.layers=this.layers,this.add(s);let r=new en(hr,ur,e,t);r.layers=this.layers,this.add(r);let o=new en(hr,ur,e,t);o.layers=this.layers,this.add(o);let a=new en(hr,ur,e,t);a.layers=this.layers,this.add(a);let c=new en(hr,ur,e,t);c.layers=this.layers,this.add(c);let l=new en(hr,ur,e,t);l.layers=this.layers,this.add(l)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,s,r,o,a,c]=t;for(let l of t)this.remove(l);if(e===wi)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),c.up.set(0,1,0),c.lookAt(0,0,-1);else if(e===Wa)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),c.up.set(0,-1,0),c.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let l of t)this.add(l),l.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,o,a,c,l,h]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),m=e.xr.enabled;e.xr.enabled=!1;let _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,o),e.setRenderTarget(n,2,s),e.render(t,a),e.setRenderTarget(n,3,s),e.render(t,c),e.setRenderTarget(n,4,s),e.render(t,l),n.texture.generateMipmaps=_,e.setRenderTarget(n,5,s),e.render(t,h),e.setRenderTarget(u,d,f),e.xr.enabled=m,n.texture.needsPMREMUpdate=!0}},ja=class extends nn{constructor(e,t,n,s,r,o,a,c,l,h){e=e!==void 0?e:[],t=t!==void 0?t:Er,super(e,t,n,s,r,o,a,c,l,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},th=class extends Ri{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];t.encoding!==void 0&&(vo("THREE.WebGLCubeRenderTarget: option.encoding has been replaced by option.colorSpace."),t.colorSpace=t.encoding===As?_t:kn),this.texture=new ja(s,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:_n}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new ut(5,5,5),r=new Ci({name:"CubemapFromEquirect",uniforms:Cr(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Mn,blending:qi});r.uniforms.tEquirect.value=t;let o=new ae(s,r),a=t.minFilter;return t.minFilter===Ki&&(t.minFilter=_n),new eh(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t,n,s){let r=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,s);e.setRenderTarget(r)}},Pl=new A,q0=new A,Y0=new je,Ei=class{constructor(e=new A(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let s=Pl.subVectors(n,t).cross(q0.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){let n=e.delta(Pl),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||Y0.getNormalMatrix(e),s=this.coplanarPoint(Pl).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},vs=new Pn,Ea=new A,Ro=class{constructor(e=new Ei,t=new Ei,n=new Ei,s=new Ei,r=new Ei,o=new Ei){this.planes=[e,t,n,s,r,o]}set(e,t,n,s,r,o){let a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=wi){let n=this.planes,s=e.elements,r=s[0],o=s[1],a=s[2],c=s[3],l=s[4],h=s[5],u=s[6],d=s[7],f=s[8],m=s[9],_=s[10],g=s[11],p=s[12],v=s[13],x=s[14],S=s[15];if(n[0].setComponents(c-r,d-l,g-f,S-p).normalize(),n[1].setComponents(c+r,d+l,g+f,S+p).normalize(),n[2].setComponents(c+o,d+h,g+m,S+v).normalize(),n[3].setComponents(c-o,d-h,g-m,S-v).normalize(),n[4].setComponents(c-a,d-u,g-_,S-x).normalize(),t===wi)n[5].setComponents(c+a,d+u,g+_,S+x).normalize();else if(t===Wa)n[5].setComponents(a,u,_,x).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),vs.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),vs.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(vs)}intersectsSprite(e){return vs.center.set(0,0,0),vs.radius=.7071067811865476,vs.applyMatrix4(e.matrixWorld),this.intersectsSphere(vs)}intersectsSphere(e){let t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let s=t[n];if(Ea.x=s.normal.x>0?e.max.x:e.min.x,Ea.y=s.normal.y>0?e.max.y:e.min.y,Ea.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(Ea)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};function Tp(){let i=null,e=!1,t=null,n=null;function s(r,o){t(r,o),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function Z0(i,e){let t=e.isWebGL2,n=new WeakMap;function s(l,h){let u=l.array,d=l.usage,f=u.byteLength,m=i.createBuffer();i.bindBuffer(h,m),i.bufferData(h,u,d),l.onUploadCallback();let _;if(u instanceof Float32Array)_=i.FLOAT;else if(u instanceof Uint16Array)if(l.isFloat16BufferAttribute)if(t)_=i.HALF_FLOAT;else throw new Error("THREE.WebGLAttributes: Usage of Float16BufferAttribute requires WebGL2.");else _=i.UNSIGNED_SHORT;else if(u instanceof Int16Array)_=i.SHORT;else if(u instanceof Uint32Array)_=i.UNSIGNED_INT;else if(u instanceof Int32Array)_=i.INT;else if(u instanceof Int8Array)_=i.BYTE;else if(u instanceof Uint8Array)_=i.UNSIGNED_BYTE;else if(u instanceof Uint8ClampedArray)_=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+u);return{buffer:m,type:_,bytesPerElement:u.BYTES_PER_ELEMENT,version:l.version,size:f}}function r(l,h,u){let d=h.array,f=h._updateRange,m=h.updateRanges;if(i.bindBuffer(u,l),f.count===-1&&m.length===0&&i.bufferSubData(u,0,d),m.length!==0){for(let _=0,g=m.length;_<g;_++){let p=m[_];t?i.bufferSubData(u,p.start*d.BYTES_PER_ELEMENT,d,p.start,p.count):i.bufferSubData(u,p.start*d.BYTES_PER_ELEMENT,d.subarray(p.start,p.start+p.count))}h.clearUpdateRanges()}f.count!==-1&&(t?i.bufferSubData(u,f.offset*d.BYTES_PER_ELEMENT,d,f.offset,f.count):i.bufferSubData(u,f.offset*d.BYTES_PER_ELEMENT,d.subarray(f.offset,f.offset+f.count)),f.count=-1),h.onUploadCallback()}function o(l){return l.isInterleavedBufferAttribute&&(l=l.data),n.get(l)}function a(l){l.isInterleavedBufferAttribute&&(l=l.data);let h=n.get(l);h&&(i.deleteBuffer(h.buffer),n.delete(l))}function c(l,h){if(l.isGLBufferAttribute){let d=n.get(l);(!d||d.version<l.version)&&n.set(l,{buffer:l.buffer,type:l.type,bytesPerElement:l.elementSize,version:l.version});return}l.isInterleavedBufferAttribute&&(l=l.data);let u=n.get(l);if(u===void 0)n.set(l,s(l,h));else if(u.version<l.version){if(u.size!==l.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");r(u.buffer,l,h),u.version=l.version}}return{get:o,remove:a,update:c}}var In=class i extends Lt{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};let r=e/2,o=t/2,a=Math.floor(n),c=Math.floor(s),l=a+1,h=c+1,u=e/a,d=t/c,f=[],m=[],_=[],g=[];for(let p=0;p<h;p++){let v=p*d-o;for(let x=0;x<l;x++){let S=x*u-r;m.push(S,-v,0),_.push(0,0,1),g.push(x/a),g.push(1-p/c)}}for(let p=0;p<c;p++)for(let v=0;v<a;v++){let x=v+l*p,S=v+l*(p+1),P=v+1+l*(p+1),T=v+1+l*p;f.push(x,S,T),f.push(S,P,T)}this.setIndex(f),this.setAttribute("position",new lt(m,3)),this.setAttribute("normal",new lt(_,3)),this.setAttribute("uv",new lt(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}},K0=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,$0=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,J0=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,j0=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Q0=`#ifdef USE_ALPHATEST
	if ( diffuseColor.a < alphaTest ) discard;
#endif`,e_=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,t_=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,n_=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,i_=`#ifdef USE_BATCHING
	attribute float batchId;
	uniform highp sampler2D batchingTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,s_=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( batchId );
#endif`,r_=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,o_=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,a_=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,c_=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,l_=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,h_=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#pragma unroll_loop_start
	for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
		plane = clippingPlanes[ i ];
		if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
	}
	#pragma unroll_loop_end
	#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
		bool clipped = true;
		#pragma unroll_loop_start
		for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
		}
		#pragma unroll_loop_end
		if ( clipped ) discard;
	#endif
#endif`,u_=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,d_=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,f_=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,p_=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,m_=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,g_=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	varying vec3 vColor;
#endif`,__=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif`,x_=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
float luminance( const in vec3 rgb ) {
	const vec3 weights = vec3( 0.2126729, 0.7151522, 0.0721750 );
	return dot( weights, rgb );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,y_=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,v_=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,M_=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,S_=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,E_=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,b_=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,w_="gl_FragColor = linearToOutputTexel( gl_FragColor );",T_=`
const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec4 LinearToLinear( in vec4 value ) {
	return value;
}
vec4 LinearTosRGB( in vec4 value ) {
	return sRGBTransferOETF( value );
}`,A_=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,R_=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,C_=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,P_=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,L_=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,I_=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,D_=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,N_=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,U_=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,O_=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,F_=`#ifdef USE_LIGHTMAP
	vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
	vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
	reflectedLight.indirectDiffuse += lightMapIrradiance;
#endif`,B_=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,k_=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,z_=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,H_=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	#if defined ( LEGACY_LIGHTS )
		if ( cutoffDistance > 0.0 && decayExponent > 0.0 ) {
			return pow( saturate( - lightDistance / cutoffDistance + 1.0 ), decayExponent );
		}
		return 1.0;
	#else
		float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
		if ( cutoffDistance > 0.0 ) {
			distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
		}
		return distanceFalloff;
	#endif
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,G_=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,V_=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,W_=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,X_=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,q_=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Y_=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,Z_=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,K_=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,$_=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,J_=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,j_=`#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	gl_FragDepthEXT = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Q_=`#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,ex=`#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		varying float vFragDepth;
		varying float vIsPerspective;
	#else
		uniform float logDepthBufFC;
	#endif
#endif`,tx=`#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		vFragDepth = 1.0 + gl_Position.w;
		vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
	#else
		if ( isPerspectiveMatrix( projectionMatrix ) ) {
			gl_Position.z = log2( max( EPSILON, gl_Position.w + 1.0 ) ) * logDepthBufFC - 1.0;
			gl_Position.z *= gl_Position.w;
		}
	#endif
#endif`,nx=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,ix=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,sx=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,rx=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,ox=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,ax=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,cx=`#if defined( USE_MORPHCOLORS ) && defined( MORPHTARGETS_TEXTURE )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,lx=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
			if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
		}
	#else
		objectNormal += morphNormal0 * morphTargetInfluences[ 0 ];
		objectNormal += morphNormal1 * morphTargetInfluences[ 1 ];
		objectNormal += morphNormal2 * morphTargetInfluences[ 2 ];
		objectNormal += morphNormal3 * morphTargetInfluences[ 3 ];
	#endif
#endif`,hx=`#ifdef USE_MORPHTARGETS
	uniform float morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
		uniform sampler2DArray morphTargetsTexture;
		uniform ivec2 morphTargetsTextureSize;
		vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
			int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
			int y = texelIndex / morphTargetsTextureSize.x;
			int x = texelIndex - y * morphTargetsTextureSize.x;
			ivec3 morphUV = ivec3( x, y, morphTargetIndex );
			return texelFetch( morphTargetsTexture, morphUV, 0 );
		}
	#else
		#ifndef USE_MORPHNORMALS
			uniform float morphTargetInfluences[ 8 ];
		#else
			uniform float morphTargetInfluences[ 4 ];
		#endif
	#endif
#endif`,ux=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
			if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
		}
	#else
		transformed += morphTarget0 * morphTargetInfluences[ 0 ];
		transformed += morphTarget1 * morphTargetInfluences[ 1 ];
		transformed += morphTarget2 * morphTargetInfluences[ 2 ];
		transformed += morphTarget3 * morphTargetInfluences[ 3 ];
		#ifndef USE_MORPHNORMALS
			transformed += morphTarget4 * morphTargetInfluences[ 4 ];
			transformed += morphTarget5 * morphTargetInfluences[ 5 ];
			transformed += morphTarget6 * morphTargetInfluences[ 6 ];
			transformed += morphTarget7 * morphTargetInfluences[ 7 ];
		#endif
	#endif
#endif`,dx=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,fx=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,px=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,mx=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,gx=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,_x=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,xx=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,yx=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,vx=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Mx=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Sx=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Ex=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;
const vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256., 256. );
const vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );
const float ShiftRight8 = 1. / 256.;
vec4 packDepthToRGBA( const in float v ) {
	vec4 r = vec4( fract( v * PackFactors ), v );
	r.yzw -= r.xyz * ShiftRight8;	return r * PackUpscale;
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors );
}
vec2 packDepthToRG( in highp float v ) {
	return packDepthToRGBA( v ).yx;
}
float unpackRGToDepth( const in highp vec2 v ) {
	return unpackRGBAToDepth( vec4( v.xy, 0.0, 0.0 ) );
}
vec4 pack2HalfToRGBA( vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,bx=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,wx=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Tx=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Ax=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Rx=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Cx=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Px=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return shadow;
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
		vec3 lightToPosition = shadowCoord.xyz;
		float dp = ( length( lightToPosition ) - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );		dp += shadowBias;
		vec3 bd3D = normalize( lightToPosition );
		#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
			vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
			return (
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
			) * ( 1.0 / 9.0 );
		#else
			return texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
		#endif
	}
#endif`,Lx=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Ix=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Dx=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Nx=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Ux=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Ox=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Fx=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Bx=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,kx=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,zx=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Hx=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 OptimizedCineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color *= toneMappingExposure;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	return color;
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Gx=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Vx=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
		vec3 refractedRayExit = position + transmissionRay;
		vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
		vec2 refractionCoords = ndcPos.xy / ndcPos.w;
		refractionCoords += 1.0;
		refractionCoords /= 2.0;
		vec4 transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
		vec3 transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Wx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Xx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,qx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,Yx=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,Zx=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Kx=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,$x=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Jx=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,jx=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Qx=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,ey=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,ty=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( 1.0 );
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#endif
}`,ny=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,iy=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( 1.0 );
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,sy=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,ry=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,oy=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,ay=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,cy=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,ly=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,hy=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,uy=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,dy=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,fy=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,py=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,my=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), opacity );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,gy=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,_y=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,xy=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,yy=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,vy=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,My=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Sy=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,Ey=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,by=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,wy=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Ty=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec2 scale;
	scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
	scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Ay=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Ze={alphahash_fragment:K0,alphahash_pars_fragment:$0,alphamap_fragment:J0,alphamap_pars_fragment:j0,alphatest_fragment:Q0,alphatest_pars_fragment:e_,aomap_fragment:t_,aomap_pars_fragment:n_,batching_pars_vertex:i_,batching_vertex:s_,begin_vertex:r_,beginnormal_vertex:o_,bsdfs:a_,iridescence_fragment:c_,bumpmap_pars_fragment:l_,clipping_planes_fragment:h_,clipping_planes_pars_fragment:u_,clipping_planes_pars_vertex:d_,clipping_planes_vertex:f_,color_fragment:p_,color_pars_fragment:m_,color_pars_vertex:g_,color_vertex:__,common:x_,cube_uv_reflection_fragment:y_,defaultnormal_vertex:v_,displacementmap_pars_vertex:M_,displacementmap_vertex:S_,emissivemap_fragment:E_,emissivemap_pars_fragment:b_,colorspace_fragment:w_,colorspace_pars_fragment:T_,envmap_fragment:A_,envmap_common_pars_fragment:R_,envmap_pars_fragment:C_,envmap_pars_vertex:P_,envmap_physical_pars_fragment:G_,envmap_vertex:L_,fog_vertex:I_,fog_pars_vertex:D_,fog_fragment:N_,fog_pars_fragment:U_,gradientmap_pars_fragment:O_,lightmap_fragment:F_,lightmap_pars_fragment:B_,lights_lambert_fragment:k_,lights_lambert_pars_fragment:z_,lights_pars_begin:H_,lights_toon_fragment:V_,lights_toon_pars_fragment:W_,lights_phong_fragment:X_,lights_phong_pars_fragment:q_,lights_physical_fragment:Y_,lights_physical_pars_fragment:Z_,lights_fragment_begin:K_,lights_fragment_maps:$_,lights_fragment_end:J_,logdepthbuf_fragment:j_,logdepthbuf_pars_fragment:Q_,logdepthbuf_pars_vertex:ex,logdepthbuf_vertex:tx,map_fragment:nx,map_pars_fragment:ix,map_particle_fragment:sx,map_particle_pars_fragment:rx,metalnessmap_fragment:ox,metalnessmap_pars_fragment:ax,morphcolor_vertex:cx,morphnormal_vertex:lx,morphtarget_pars_vertex:hx,morphtarget_vertex:ux,normal_fragment_begin:dx,normal_fragment_maps:fx,normal_pars_fragment:px,normal_pars_vertex:mx,normal_vertex:gx,normalmap_pars_fragment:_x,clearcoat_normal_fragment_begin:xx,clearcoat_normal_fragment_maps:yx,clearcoat_pars_fragment:vx,iridescence_pars_fragment:Mx,opaque_fragment:Sx,packing:Ex,premultiplied_alpha_fragment:bx,project_vertex:wx,dithering_fragment:Tx,dithering_pars_fragment:Ax,roughnessmap_fragment:Rx,roughnessmap_pars_fragment:Cx,shadowmap_pars_fragment:Px,shadowmap_pars_vertex:Lx,shadowmap_vertex:Ix,shadowmask_pars_fragment:Dx,skinbase_vertex:Nx,skinning_pars_vertex:Ux,skinning_vertex:Ox,skinnormal_vertex:Fx,specularmap_fragment:Bx,specularmap_pars_fragment:kx,tonemapping_fragment:zx,tonemapping_pars_fragment:Hx,transmission_fragment:Gx,transmission_pars_fragment:Vx,uv_pars_fragment:Wx,uv_pars_vertex:Xx,uv_vertex:qx,worldpos_vertex:Yx,background_vert:Zx,background_frag:Kx,backgroundCube_vert:$x,backgroundCube_frag:Jx,cube_vert:jx,cube_frag:Qx,depth_vert:ey,depth_frag:ty,distanceRGBA_vert:ny,distanceRGBA_frag:iy,equirect_vert:sy,equirect_frag:ry,linedashed_vert:oy,linedashed_frag:ay,meshbasic_vert:cy,meshbasic_frag:ly,meshlambert_vert:hy,meshlambert_frag:uy,meshmatcap_vert:dy,meshmatcap_frag:fy,meshnormal_vert:py,meshnormal_frag:my,meshphong_vert:gy,meshphong_frag:_y,meshphysical_vert:xy,meshphysical_frag:yy,meshtoon_vert:vy,meshtoon_frag:My,points_vert:Sy,points_frag:Ey,shadow_vert:by,shadow_frag:wy,sprite_vert:Ty,sprite_frag:Ay},he={common:{diffuse:{value:new Ee(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new je},alphaMap:{value:null},alphaMapTransform:{value:new je},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new je}},envmap:{envMap:{value:null},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new je}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new je}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new je},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new je},normalScale:{value:new se(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new je},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new je}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new je}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new je}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ee(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Ee(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new je},alphaTest:{value:0},uvTransform:{value:new je}},sprite:{diffuse:{value:new Ee(16777215)},opacity:{value:1},center:{value:new se(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new je},alphaMap:{value:null},alphaMapTransform:{value:new je},alphaTest:{value:0}}},ii={basic:{uniforms:gn([he.common,he.specularmap,he.envmap,he.aomap,he.lightmap,he.fog]),vertexShader:Ze.meshbasic_vert,fragmentShader:Ze.meshbasic_frag},lambert:{uniforms:gn([he.common,he.specularmap,he.envmap,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.fog,he.lights,{emissive:{value:new Ee(0)}}]),vertexShader:Ze.meshlambert_vert,fragmentShader:Ze.meshlambert_frag},phong:{uniforms:gn([he.common,he.specularmap,he.envmap,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.fog,he.lights,{emissive:{value:new Ee(0)},specular:{value:new Ee(1118481)},shininess:{value:30}}]),vertexShader:Ze.meshphong_vert,fragmentShader:Ze.meshphong_frag},standard:{uniforms:gn([he.common,he.envmap,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.roughnessmap,he.metalnessmap,he.fog,he.lights,{emissive:{value:new Ee(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ze.meshphysical_vert,fragmentShader:Ze.meshphysical_frag},toon:{uniforms:gn([he.common,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.gradientmap,he.fog,he.lights,{emissive:{value:new Ee(0)}}]),vertexShader:Ze.meshtoon_vert,fragmentShader:Ze.meshtoon_frag},matcap:{uniforms:gn([he.common,he.bumpmap,he.normalmap,he.displacementmap,he.fog,{matcap:{value:null}}]),vertexShader:Ze.meshmatcap_vert,fragmentShader:Ze.meshmatcap_frag},points:{uniforms:gn([he.points,he.fog]),vertexShader:Ze.points_vert,fragmentShader:Ze.points_frag},dashed:{uniforms:gn([he.common,he.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ze.linedashed_vert,fragmentShader:Ze.linedashed_frag},depth:{uniforms:gn([he.common,he.displacementmap]),vertexShader:Ze.depth_vert,fragmentShader:Ze.depth_frag},normal:{uniforms:gn([he.common,he.bumpmap,he.normalmap,he.displacementmap,{opacity:{value:1}}]),vertexShader:Ze.meshnormal_vert,fragmentShader:Ze.meshnormal_frag},sprite:{uniforms:gn([he.sprite,he.fog]),vertexShader:Ze.sprite_vert,fragmentShader:Ze.sprite_frag},background:{uniforms:{uvTransform:{value:new je},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ze.background_vert,fragmentShader:Ze.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1}},vertexShader:Ze.backgroundCube_vert,fragmentShader:Ze.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ze.cube_vert,fragmentShader:Ze.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ze.equirect_vert,fragmentShader:Ze.equirect_frag},distanceRGBA:{uniforms:gn([he.common,he.displacementmap,{referencePosition:{value:new A},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ze.distanceRGBA_vert,fragmentShader:Ze.distanceRGBA_frag},shadow:{uniforms:gn([he.lights,he.fog,{color:{value:new Ee(0)},opacity:{value:1}}]),vertexShader:Ze.shadow_vert,fragmentShader:Ze.shadow_frag}};ii.physical={uniforms:gn([ii.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new je},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new je},clearcoatNormalScale:{value:new se(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new je},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new je},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new je},sheen:{value:0},sheenColor:{value:new Ee(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new je},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new je},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new je},transmissionSamplerSize:{value:new se},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new je},attenuationDistance:{value:0},attenuationColor:{value:new Ee(0)},specularColor:{value:new Ee(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new je},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new je},anisotropyVector:{value:new se},anisotropyMap:{value:null},anisotropyMapTransform:{value:new je}}]),vertexShader:Ze.meshphysical_vert,fragmentShader:Ze.meshphysical_frag};var ba={r:0,b:0,g:0};function Ry(i,e,t,n,s,r,o){let a=new Ee(0),c=r===!0?0:1,l,h,u=null,d=0,f=null;function m(g,p){let v=!1,x=p.isScene===!0?p.background:null;x&&x.isTexture&&(x=(p.backgroundBlurriness>0?t:e).get(x)),x===null?_(a,c):x&&x.isColor&&(_(x,1),v=!0);let S=i.xr.getEnvironmentBlendMode();S==="additive"?n.buffers.color.setClear(0,0,0,1,o):S==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||v)&&i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil),x&&(x.isCubeTexture||x.mapping===Tc)?(h===void 0&&(h=new ae(new ut(1,1,1),new Ci({name:"BackgroundCubeMaterial",uniforms:Cr(ii.backgroundCube.uniforms),vertexShader:ii.backgroundCube.vertexShader,fragmentShader:ii.backgroundCube.fragmentShader,side:Mn,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(P,T,R){this.matrixWorld.copyPosition(R.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(h)),h.material.uniforms.envMap.value=x,h.material.uniforms.flipEnvMap.value=x.isCubeTexture&&x.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=p.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=p.backgroundIntensity,h.material.toneMapped=ft.getTransfer(x.colorSpace)!==wt,(u!==x||d!==x.version||f!==i.toneMapping)&&(h.material.needsUpdate=!0,u=x,d=x.version,f=i.toneMapping),h.layers.enableAll(),g.unshift(h,h.geometry,h.material,0,0,null)):x&&x.isTexture&&(l===void 0&&(l=new ae(new In(2,2),new Ci({name:"BackgroundMaterial",uniforms:Cr(ii.background.uniforms),vertexShader:ii.background.vertexShader,fragmentShader:ii.background.fragmentShader,side:oi,depthTest:!1,depthWrite:!1,fog:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(l)),l.material.uniforms.t2D.value=x,l.material.uniforms.backgroundIntensity.value=p.backgroundIntensity,l.material.toneMapped=ft.getTransfer(x.colorSpace)!==wt,x.matrixAutoUpdate===!0&&x.updateMatrix(),l.material.uniforms.uvTransform.value.copy(x.matrix),(u!==x||d!==x.version||f!==i.toneMapping)&&(l.material.needsUpdate=!0,u=x,d=x.version,f=i.toneMapping),l.layers.enableAll(),g.unshift(l,l.geometry,l.material,0,0,null))}function _(g,p){g.getRGB(ba,wp(i)),n.buffers.color.setClear(ba.r,ba.g,ba.b,p,o)}return{getClearColor:function(){return a},setClearColor:function(g,p=1){a.set(g),c=p,_(a,c)},getClearAlpha:function(){return c},setClearAlpha:function(g){c=g,_(a,c)},render:m}}function Cy(i,e,t,n){let s=i.getParameter(i.MAX_VERTEX_ATTRIBS),r=n.isWebGL2?null:e.get("OES_vertex_array_object"),o=n.isWebGL2||r!==null,a={},c=g(null),l=c,h=!1;function u(I,O,H,K,Y){let V=!1;if(o){let ee=_(K,H,O);l!==ee&&(l=ee,f(l.object)),V=p(I,K,H,Y),V&&v(I,K,H,Y)}else{let ee=O.wireframe===!0;(l.geometry!==K.id||l.program!==H.id||l.wireframe!==ee)&&(l.geometry=K.id,l.program=H.id,l.wireframe=ee,V=!0)}Y!==null&&t.update(Y,i.ELEMENT_ARRAY_BUFFER),(V||h)&&(h=!1,F(I,O,H,K),Y!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,t.get(Y).buffer))}function d(){return n.isWebGL2?i.createVertexArray():r.createVertexArrayOES()}function f(I){return n.isWebGL2?i.bindVertexArray(I):r.bindVertexArrayOES(I)}function m(I){return n.isWebGL2?i.deleteVertexArray(I):r.deleteVertexArrayOES(I)}function _(I,O,H){let K=H.wireframe===!0,Y=a[I.id];Y===void 0&&(Y={},a[I.id]=Y);let V=Y[O.id];V===void 0&&(V={},Y[O.id]=V);let ee=V[K];return ee===void 0&&(ee=g(d()),V[K]=ee),ee}function g(I){let O=[],H=[],K=[];for(let Y=0;Y<s;Y++)O[Y]=0,H[Y]=0,K[Y]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:O,enabledAttributes:H,attributeDivisors:K,object:I,attributes:{},index:null}}function p(I,O,H,K){let Y=l.attributes,V=O.attributes,ee=0,te=H.getAttributes();for(let me in te)if(te[me].location>=0){let J=Y[me],ge=V[me];if(ge===void 0&&(me==="instanceMatrix"&&I.instanceMatrix&&(ge=I.instanceMatrix),me==="instanceColor"&&I.instanceColor&&(ge=I.instanceColor)),J===void 0||J.attribute!==ge||ge&&J.data!==ge.data)return!0;ee++}return l.attributesNum!==ee||l.index!==K}function v(I,O,H,K){let Y={},V=O.attributes,ee=0,te=H.getAttributes();for(let me in te)if(te[me].location>=0){let J=V[me];J===void 0&&(me==="instanceMatrix"&&I.instanceMatrix&&(J=I.instanceMatrix),me==="instanceColor"&&I.instanceColor&&(J=I.instanceColor));let ge={};ge.attribute=J,J&&J.data&&(ge.data=J.data),Y[me]=ge,ee++}l.attributes=Y,l.attributesNum=ee,l.index=K}function x(){let I=l.newAttributes;for(let O=0,H=I.length;O<H;O++)I[O]=0}function S(I){P(I,0)}function P(I,O){let H=l.newAttributes,K=l.enabledAttributes,Y=l.attributeDivisors;H[I]=1,K[I]===0&&(i.enableVertexAttribArray(I),K[I]=1),Y[I]!==O&&((n.isWebGL2?i:e.get("ANGLE_instanced_arrays"))[n.isWebGL2?"vertexAttribDivisor":"vertexAttribDivisorANGLE"](I,O),Y[I]=O)}function T(){let I=l.newAttributes,O=l.enabledAttributes;for(let H=0,K=O.length;H<K;H++)O[H]!==I[H]&&(i.disableVertexAttribArray(H),O[H]=0)}function R(I,O,H,K,Y,V,ee){ee===!0?i.vertexAttribIPointer(I,O,H,Y,V):i.vertexAttribPointer(I,O,H,K,Y,V)}function F(I,O,H,K){if(n.isWebGL2===!1&&(I.isInstancedMesh||K.isInstancedBufferGeometry)&&e.get("ANGLE_instanced_arrays")===null)return;x();let Y=K.attributes,V=H.getAttributes(),ee=O.defaultAttributeValues;for(let te in V){let me=V[te];if(me.location>=0){let G=Y[te];if(G===void 0&&(te==="instanceMatrix"&&I.instanceMatrix&&(G=I.instanceMatrix),te==="instanceColor"&&I.instanceColor&&(G=I.instanceColor)),G!==void 0){let J=G.normalized,ge=G.itemSize,Ae=t.get(G);if(Ae===void 0)continue;let ye=Ae.buffer,Fe=Ae.type,Ve=Ae.bytesPerElement,Re=n.isWebGL2===!0&&(Fe===i.INT||Fe===i.UNSIGNED_INT||G.gpuType===dp);if(G.isInterleavedBufferAttribute){let He=G.data,C=He.stride,ce=G.offset;if(He.isInstancedInterleavedBuffer){for(let X=0;X<me.locationSize;X++)P(me.location+X,He.meshPerAttribute);I.isInstancedMesh!==!0&&K._maxInstanceCount===void 0&&(K._maxInstanceCount=He.meshPerAttribute*He.count)}else for(let X=0;X<me.locationSize;X++)S(me.location+X);i.bindBuffer(i.ARRAY_BUFFER,ye);for(let X=0;X<me.locationSize;X++)R(me.location+X,ge/me.locationSize,Fe,J,C*Ve,(ce+ge/me.locationSize*X)*Ve,Re)}else{if(G.isInstancedBufferAttribute){for(let He=0;He<me.locationSize;He++)P(me.location+He,G.meshPerAttribute);I.isInstancedMesh!==!0&&K._maxInstanceCount===void 0&&(K._maxInstanceCount=G.meshPerAttribute*G.count)}else for(let He=0;He<me.locationSize;He++)S(me.location+He);i.bindBuffer(i.ARRAY_BUFFER,ye);for(let He=0;He<me.locationSize;He++)R(me.location+He,ge/me.locationSize,Fe,J,ge*Ve,ge/me.locationSize*He*Ve,Re)}}else if(ee!==void 0){let J=ee[te];if(J!==void 0)switch(J.length){case 2:i.vertexAttrib2fv(me.location,J);break;case 3:i.vertexAttrib3fv(me.location,J);break;case 4:i.vertexAttrib4fv(me.location,J);break;default:i.vertexAttrib1fv(me.location,J)}}}}T()}function M(){q();for(let I in a){let O=a[I];for(let H in O){let K=O[H];for(let Y in K)m(K[Y].object),delete K[Y];delete O[H]}delete a[I]}}function w(I){if(a[I.id]===void 0)return;let O=a[I.id];for(let H in O){let K=O[H];for(let Y in K)m(K[Y].object),delete K[Y];delete O[H]}delete a[I.id]}function U(I){for(let O in a){let H=a[O];if(H[I.id]===void 0)continue;let K=H[I.id];for(let Y in K)m(K[Y].object),delete K[Y];delete H[I.id]}}function q(){re(),h=!0,l!==c&&(l=c,f(l.object))}function re(){c.geometry=null,c.program=null,c.wireframe=!1}return{setup:u,reset:q,resetDefaultState:re,dispose:M,releaseStatesOfGeometry:w,releaseStatesOfProgram:U,initAttributes:x,enableAttribute:S,disableUnusedAttributes:T}}function Py(i,e,t,n){let s=n.isWebGL2,r;function o(h){r=h}function a(h,u){i.drawArrays(r,h,u),t.update(u,r,1)}function c(h,u,d){if(d===0)return;let f,m;if(s)f=i,m="drawArraysInstanced";else if(f=e.get("ANGLE_instanced_arrays"),m="drawArraysInstancedANGLE",f===null){console.error("THREE.WebGLBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");return}f[m](r,h,u,d),t.update(u,r,d)}function l(h,u,d){if(d===0)return;let f=e.get("WEBGL_multi_draw");if(f===null)for(let m=0;m<d;m++)this.render(h[m],u[m]);else{f.multiDrawArraysWEBGL(r,h,0,u,0,d);let m=0;for(let _=0;_<d;_++)m+=u[_];t.update(m,r,1)}}this.setMode=o,this.render=a,this.renderInstances=c,this.renderMultiDraw=l}function Ly(i,e,t){let n;function s(){if(n!==void 0)return n;if(e.has("EXT_texture_filter_anisotropic")===!0){let R=e.get("EXT_texture_filter_anisotropic");n=i.getParameter(R.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else n=0;return n}function r(R){if(R==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";R="mediump"}return R==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let o=typeof WebGL2RenderingContext<"u"&&i.constructor.name==="WebGL2RenderingContext",a=t.precision!==void 0?t.precision:"highp",c=r(a);c!==a&&(console.warn("THREE.WebGLRenderer:",a,"not supported, using",c,"instead."),a=c);let l=o||e.has("WEBGL_draw_buffers"),h=t.logarithmicDepthBuffer===!0,u=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),d=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),f=i.getParameter(i.MAX_TEXTURE_SIZE),m=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),_=i.getParameter(i.MAX_VERTEX_ATTRIBS),g=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),p=i.getParameter(i.MAX_VARYING_VECTORS),v=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),x=d>0,S=o||e.has("OES_texture_float"),P=x&&S,T=o?i.getParameter(i.MAX_SAMPLES):0;return{isWebGL2:o,drawBuffers:l,getMaxAnisotropy:s,getMaxPrecision:r,precision:a,logarithmicDepthBuffer:h,maxTextures:u,maxVertexTextures:d,maxTextureSize:f,maxCubemapSize:m,maxAttributes:_,maxVertexUniforms:g,maxVaryings:p,maxFragmentUniforms:v,vertexTextures:x,floatFragmentTextures:S,floatVertexTextures:P,maxSamples:T}}function Iy(i){let e=this,t=null,n=0,s=!1,r=!1,o=new Ei,a=new je,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){let f=u.length!==0||d||n!==0||s;return s=d,n=u.length,f},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(u,d){t=h(u,d,0)},this.setState=function(u,d,f){let m=u.clippingPlanes,_=u.clipIntersection,g=u.clipShadows,p=i.get(u);if(!s||m===null||m.length===0||r&&!g)r?h(null):l();else{let v=r?0:n,x=v*4,S=p.clippingState||null;c.value=S,S=h(m,d,x,f);for(let P=0;P!==x;++P)S[P]=t[P];p.clippingState=S,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=v}};function l(){c.value!==t&&(c.value=t,c.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,d,f,m){let _=u!==null?u.length:0,g=null;if(_!==0){if(g=c.value,m!==!0||g===null){let p=f+_*4,v=d.matrixWorldInverse;a.getNormalMatrix(v),(g===null||g.length<p)&&(g=new Float32Array(p));for(let x=0,S=f;x!==_;++x,S+=4)o.copy(u[x]).applyMatrix4(v,a),o.normal.toArray(g,S),g[S+3]=o.constant}c.value=g,c.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,g}}function Dy(i){let e=new WeakMap;function t(o,a){return a===Yl?o.mapping=Er:a===Zl&&(o.mapping=br),o}function n(o){if(o&&o.isTexture){let a=o.mapping;if(a===Yl||a===Zl)if(e.has(o)){let c=e.get(o).texture;return t(c,o.mapping)}else{let c=o.image;if(c&&c.height>0){let l=new th(c.height/2);return l.fromEquirectangularTexture(i,o),e.set(o,l),o.addEventListener("dispose",s),t(l.texture,o.mapping)}else return null}}return o}function s(o){let a=o.target;a.removeEventListener("dispose",s);let c=e.get(a);c!==void 0&&(e.delete(a),c.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}var $i=class extends Ja{constructor(e=-1,t=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=n-e,o=n+e,a=s+t,c=s-t;if(this.view!==null&&this.view.enabled){let l=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=l*this.view.offsetX,o=r+l*this.view.width,a-=h*this.view.offsetY,c=a-h*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,c,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},gr=4,_f=[.125,.215,.35,.446,.526,.582],Es=20,Ll=new $i,xf=new Ee,Il=null,Dl=0,Nl=0,Ms=(1+Math.sqrt(5))/2,dr=1/Ms,yf=[new A(1,1,1),new A(-1,1,1),new A(1,1,-1),new A(-1,1,-1),new A(0,Ms,dr),new A(0,Ms,-dr),new A(dr,0,Ms),new A(-dr,0,Ms),new A(Ms,dr,0),new A(-Ms,dr,0)],Qa=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100){Il=this._renderer.getRenderTarget(),Dl=this._renderer.getActiveCubeFace(),Nl=this._renderer.getActiveMipmapLevel(),this._setSize(256);let r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(e,n,s,r),t>0&&this._blur(r,0,0,t),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Sf(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Mf(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Il,Dl,Nl),e.scissorTest=!1,wa(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Er||e.mapping===br?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Il=this._renderer.getRenderTarget(),Dl=this._renderer.getActiveCubeFace(),Nl=this._renderer.getActiveMipmapLevel();let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:_n,minFilter:_n,generateMipmaps:!1,type:wo,format:Bn,colorSpace:Ht,depthBuffer:!1},s=vf(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=vf(e,t,n);let{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=Ny(r)),this._blurMaterial=Uy(r,e,t)}return s}_compileMaterial(e){let t=new ae(this._lodPlanes[0],e);this._renderer.compile(t,Ll)}_sceneToCubeUV(e,t,n,s){let a=new en(90,1,t,n),c=[1,-1,1,1,1,1],l=[1,1,1,-1,-1,-1],h=this._renderer,u=h.autoClear,d=h.toneMapping;h.getClearColor(xf),h.toneMapping=ri,h.autoClear=!1;let f=new rt({name:"PMREM.Background",side:Mn,depthWrite:!1,depthTest:!1}),m=new ae(new ut,f),_=!1,g=e.background;g?g.isColor&&(f.color.copy(g),e.background=null,_=!0):(f.color.copy(xf),_=!0);for(let p=0;p<6;p++){let v=p%3;v===0?(a.up.set(0,c[p],0),a.lookAt(l[p],0,0)):v===1?(a.up.set(0,0,c[p]),a.lookAt(0,l[p],0)):(a.up.set(0,c[p],0),a.lookAt(0,0,l[p]));let x=this._cubeSize;wa(s,v*x,p>2?x:0,x,x),h.setRenderTarget(s),_&&h.render(m,a),h.render(e,a)}m.geometry.dispose(),m.material.dispose(),h.toneMapping=d,h.autoClear=u,e.background=g}_textureToCubeUV(e,t){let n=this._renderer,s=e.mapping===Er||e.mapping===br;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=Sf()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Mf());let r=s?this._cubemapMaterial:this._equirectMaterial,o=new ae(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=e;let c=this._cubeSize;wa(t,0,0,3*c,2*c),n.setRenderTarget(t),n.render(o,Ll)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;for(let s=1;s<this._lodPlanes.length;s++){let r=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),o=yf[(s-1)%yf.length];this._blur(e,s-1,s,r,o)}t.autoClear=n}_blur(e,t,n,s,r){let o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,s,"latitudinal",r),this._halfBlur(o,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,o,a){let c=this._renderer,l=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");let h=3,u=new ae(this._lodPlanes[s],l),d=l.uniforms,f=this._sizeLods[n]-1,m=isFinite(r)?Math.PI/(2*f):2*Math.PI/(2*Es-1),_=r/m,g=isFinite(r)?1+Math.floor(h*_):Es;g>Es&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${g} samples when the maximum is set to ${Es}`);let p=[],v=0;for(let R=0;R<Es;++R){let F=R/_,M=Math.exp(-F*F/2);p.push(M),R===0?v+=M:R<g&&(v+=2*M)}for(let R=0;R<p.length;R++)p[R]=p[R]/v;d.envMap.value=e.texture,d.samples.value=g,d.weights.value=p,d.latitudinal.value=o==="latitudinal",a&&(d.poleAxis.value=a);let{_lodMax:x}=this;d.dTheta.value=m,d.mipInt.value=x-n;let S=this._sizeLods[s],P=3*S*(s>x-gr?s-x+gr:0),T=4*(this._cubeSize-S);wa(t,P,T,3*S,2*S),c.setRenderTarget(t),c.render(u,Ll)}};function Ny(i){let e=[],t=[],n=[],s=i,r=i-gr+1+_f.length;for(let o=0;o<r;o++){let a=Math.pow(2,s);t.push(a);let c=1/a;o>i-gr?c=_f[o-i+gr-1]:o===0&&(c=0),n.push(c);let l=1/(a-2),h=-l,u=1+l,d=[h,h,u,h,u,u,h,h,u,u,h,u],f=6,m=6,_=3,g=2,p=1,v=new Float32Array(_*m*f),x=new Float32Array(g*m*f),S=new Float32Array(p*m*f);for(let T=0;T<f;T++){let R=T%3*2/3-1,F=T>2?0:-1,M=[R,F,0,R+2/3,F,0,R+2/3,F+1,0,R,F,0,R+2/3,F+1,0,R,F+1,0];v.set(M,_*m*T),x.set(d,g*m*T);let w=[T,T,T,T,T,T];S.set(w,p*m*T)}let P=new Lt;P.setAttribute("position",new Ot(v,_)),P.setAttribute("uv",new Ot(x,g)),P.setAttribute("faceIndex",new Ot(S,p)),e.push(P),s>gr&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function vf(i,e,t){let n=new Ri(i,e,t);return n.texture.mapping=Tc,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function wa(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function Uy(i,e,t){let n=new Float32Array(Es),s=new A(0,1,0);return new Ci({name:"SphericalGaussianBlur",defines:{n:Es,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:Gh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:qi,depthTest:!1,depthWrite:!1})}function Mf(){return new Ci({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Gh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:qi,depthTest:!1,depthWrite:!1})}function Sf(){return new Ci({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Gh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:qi,depthTest:!1,depthWrite:!1})}function Gh(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Oy(i){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){let c=a.mapping,l=c===Yl||c===Zl,h=c===Er||c===br;if(l||h)if(a.isRenderTargetTexture&&a.needsPMREMUpdate===!0){a.needsPMREMUpdate=!1;let u=e.get(a);return t===null&&(t=new Qa(i)),u=l?t.fromEquirectangular(a,u):t.fromCubemap(a,u),e.set(a,u),u.texture}else{if(e.has(a))return e.get(a).texture;{let u=a.image;if(l&&u&&u.height>0||h&&u&&s(u)){t===null&&(t=new Qa(i));let d=l?t.fromEquirectangular(a):t.fromCubemap(a);return e.set(a,d),a.addEventListener("dispose",r),d.texture}else return null}}}return a}function s(a){let c=0,l=6;for(let h=0;h<l;h++)a[h]!==void 0&&c++;return c===l}function r(a){let c=a.target;c.removeEventListener("dispose",r);let l=e.get(c);l!==void 0&&(e.delete(c),l.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function Fy(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(n){n.isWebGL2?(t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance")):(t("WEBGL_depth_texture"),t("OES_texture_float"),t("OES_texture_half_float"),t("OES_texture_half_float_linear"),t("OES_standard_derivatives"),t("OES_element_index_uint"),t("OES_vertex_array_object"),t("ANGLE_instanced_arrays")),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture")},get:function(n){let s=t(n);return s===null&&console.warn("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function By(i,e,t,n){let s={},r=new WeakMap;function o(u){let d=u.target;d.index!==null&&e.remove(d.index);for(let m in d.attributes)e.remove(d.attributes[m]);for(let m in d.morphAttributes){let _=d.morphAttributes[m];for(let g=0,p=_.length;g<p;g++)e.remove(_[g])}d.removeEventListener("dispose",o),delete s[d.id];let f=r.get(d);f&&(e.remove(f),r.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function a(u,d){return s[d.id]===!0||(d.addEventListener("dispose",o),s[d.id]=!0,t.memory.geometries++),d}function c(u){let d=u.attributes;for(let m in d)e.update(d[m],i.ARRAY_BUFFER);let f=u.morphAttributes;for(let m in f){let _=f[m];for(let g=0,p=_.length;g<p;g++)e.update(_[g],i.ARRAY_BUFFER)}}function l(u){let d=[],f=u.index,m=u.attributes.position,_=0;if(f!==null){let v=f.array;_=f.version;for(let x=0,S=v.length;x<S;x+=3){let P=v[x+0],T=v[x+1],R=v[x+2];d.push(P,T,T,R,R,P)}}else if(m!==void 0){let v=m.array;_=m.version;for(let x=0,S=v.length/3-1;x<S;x+=3){let P=x+0,T=x+1,R=x+2;d.push(P,T,T,R,R,P)}}else return;let g=new(Ep(d)?$a:Ka)(d,1);g.version=_;let p=r.get(u);p&&e.remove(p),r.set(u,g)}function h(u){let d=r.get(u);if(d){let f=u.index;f!==null&&d.version<f.version&&l(u)}else l(u);return r.get(u)}return{get:a,update:c,getWireframeAttribute:h}}function ky(i,e,t,n){let s=n.isWebGL2,r;function o(f){r=f}let a,c;function l(f){a=f.type,c=f.bytesPerElement}function h(f,m){i.drawElements(r,m,a,f*c),t.update(m,r,1)}function u(f,m,_){if(_===0)return;let g,p;if(s)g=i,p="drawElementsInstanced";else if(g=e.get("ANGLE_instanced_arrays"),p="drawElementsInstancedANGLE",g===null){console.error("THREE.WebGLIndexedBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");return}g[p](r,m,a,f*c,_),t.update(m,r,_)}function d(f,m,_){if(_===0)return;let g=e.get("WEBGL_multi_draw");if(g===null)for(let p=0;p<_;p++)this.render(f[p]/c,m[p]);else{g.multiDrawElementsWEBGL(r,m,0,a,f,0,_);let p=0;for(let v=0;v<_;v++)p+=m[v];t.update(p,r,1)}}this.setMode=o,this.setIndex=l,this.render=h,this.renderInstances=u,this.renderMultiDraw=d}function zy(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(t.calls++,o){case i.TRIANGLES:t.triangles+=a*(r/3);break;case i.LINES:t.lines+=a*(r/2);break;case i.LINE_STRIP:t.lines+=a*(r-1);break;case i.LINE_LOOP:t.lines+=a*r;break;case i.POINTS:t.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function Hy(i,e){return i[0]-e[0]}function Gy(i,e){return Math.abs(e[1])-Math.abs(i[1])}function Vy(i,e,t){let n={},s=new Float32Array(8),r=new WeakMap,o=new yt,a=[];for(let l=0;l<8;l++)a[l]=[l,0];function c(l,h,u){let d=l.morphTargetInfluences;if(e.isWebGL2===!0){let f=h.morphAttributes.position||h.morphAttributes.normal||h.morphAttributes.color,m=f!==void 0?f.length:0,_=r.get(h);if(_===void 0||_.count!==m){let I=function(){q.dispose(),r.delete(h),h.removeEventListener("dispose",I)};_!==void 0&&_.texture.dispose();let v=h.morphAttributes.position!==void 0,x=h.morphAttributes.normal!==void 0,S=h.morphAttributes.color!==void 0,P=h.morphAttributes.position||[],T=h.morphAttributes.normal||[],R=h.morphAttributes.color||[],F=0;v===!0&&(F=1),x===!0&&(F=2),S===!0&&(F=3);let M=h.attributes.position.count*F,w=1;M>e.maxTextureSize&&(w=Math.ceil(M/e.maxTextureSize),M=e.maxTextureSize);let U=new Float32Array(M*w*4*m),q=new Za(U,M,w,m);q.type=bi,q.needsUpdate=!0;let re=F*4;for(let O=0;O<m;O++){let H=P[O],K=T[O],Y=R[O],V=M*w*4*O;for(let ee=0;ee<H.count;ee++){let te=ee*re;v===!0&&(o.fromBufferAttribute(H,ee),U[V+te+0]=o.x,U[V+te+1]=o.y,U[V+te+2]=o.z,U[V+te+3]=0),x===!0&&(o.fromBufferAttribute(K,ee),U[V+te+4]=o.x,U[V+te+5]=o.y,U[V+te+6]=o.z,U[V+te+7]=0),S===!0&&(o.fromBufferAttribute(Y,ee),U[V+te+8]=o.x,U[V+te+9]=o.y,U[V+te+10]=o.z,U[V+te+11]=Y.itemSize===4?o.w:1)}}_={count:m,texture:q,size:new se(M,w)},r.set(h,_),h.addEventListener("dispose",I)}let g=0;for(let v=0;v<d.length;v++)g+=d[v];let p=h.morphTargetsRelative?1:1-g;u.getUniforms().setValue(i,"morphTargetBaseInfluence",p),u.getUniforms().setValue(i,"morphTargetInfluences",d),u.getUniforms().setValue(i,"morphTargetsTexture",_.texture,t),u.getUniforms().setValue(i,"morphTargetsTextureSize",_.size)}else{let f=d===void 0?0:d.length,m=n[h.id];if(m===void 0||m.length!==f){m=[];for(let x=0;x<f;x++)m[x]=[x,0];n[h.id]=m}for(let x=0;x<f;x++){let S=m[x];S[0]=x,S[1]=d[x]}m.sort(Gy);for(let x=0;x<8;x++)x<f&&m[x][1]?(a[x][0]=m[x][0],a[x][1]=m[x][1]):(a[x][0]=Number.MAX_SAFE_INTEGER,a[x][1]=0);a.sort(Hy);let _=h.morphAttributes.position,g=h.morphAttributes.normal,p=0;for(let x=0;x<8;x++){let S=a[x],P=S[0],T=S[1];P!==Number.MAX_SAFE_INTEGER&&T?(_&&h.getAttribute("morphTarget"+x)!==_[P]&&h.setAttribute("morphTarget"+x,_[P]),g&&h.getAttribute("morphNormal"+x)!==g[P]&&h.setAttribute("morphNormal"+x,g[P]),s[x]=T,p+=T):(_&&h.hasAttribute("morphTarget"+x)===!0&&h.deleteAttribute("morphTarget"+x),g&&h.hasAttribute("morphNormal"+x)===!0&&h.deleteAttribute("morphNormal"+x),s[x]=0)}let v=h.morphTargetsRelative?1:1-p;u.getUniforms().setValue(i,"morphTargetBaseInfluence",v),u.getUniforms().setValue(i,"morphTargetInfluences",s)}}return{update:c}}function Wy(i,e,t,n){let s=new WeakMap;function r(c){let l=n.render.frame,h=c.geometry,u=e.get(c,h);if(s.get(u)!==l&&(e.update(u),s.set(u,l)),c.isInstancedMesh&&(c.hasEventListener("dispose",a)===!1&&c.addEventListener("dispose",a),s.get(c)!==l&&(t.update(c.instanceMatrix,i.ARRAY_BUFFER),c.instanceColor!==null&&t.update(c.instanceColor,i.ARRAY_BUFFER),s.set(c,l))),c.isSkinnedMesh){let d=c.skeleton;s.get(d)!==l&&(d.update(),s.set(d,l))}return u}function o(){s=new WeakMap}function a(c){let l=c.target;l.removeEventListener("dispose",a),t.remove(l.instanceMatrix),l.instanceColor!==null&&t.remove(l.instanceColor)}return{update:r,dispose:o}}var ec=class extends nn{constructor(e,t,n,s,r,o,a,c,l,h){if(h=h!==void 0?h:Ts,h!==Ts&&h!==wr)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===Ts&&(n=Wi),n===void 0&&h===wr&&(n=ws),super(null,s,r,o,a,c,h,n,l),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=a!==void 0?a:zt,this.minFilter=c!==void 0?c:zt,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},Ap=new nn,Rp=new ec(1,1);Rp.compareFunction=Sp;var Cp=new Za,Pp=new Ql,Lp=new ja,Ef=[],bf=[],wf=new Float32Array(16),Tf=new Float32Array(9),Af=new Float32Array(4);function Br(i,e,t){let n=i[0];if(n<=0||n>0)return i;let s=e*t,r=Ef[s];if(r===void 0&&(r=new Float32Array(s),Ef[s]=r),e!==0){n.toArray(r,0);for(let o=1,a=0;o!==e;++o)a+=t,i[o].toArray(r,a)}return r}function Gt(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function Vt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function Cc(i,e){let t=bf[e];t===void 0&&(t=new Int32Array(e),bf[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function Xy(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function qy(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Gt(t,e))return;i.uniform2fv(this.addr,e),Vt(t,e)}}function Yy(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(Gt(t,e))return;i.uniform3fv(this.addr,e),Vt(t,e)}}function Zy(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Gt(t,e))return;i.uniform4fv(this.addr,e),Vt(t,e)}}function Ky(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(Gt(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),Vt(t,e)}else{if(Gt(t,n))return;Af.set(n),i.uniformMatrix2fv(this.addr,!1,Af),Vt(t,n)}}function $y(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(Gt(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),Vt(t,e)}else{if(Gt(t,n))return;Tf.set(n),i.uniformMatrix3fv(this.addr,!1,Tf),Vt(t,n)}}function Jy(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(Gt(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),Vt(t,e)}else{if(Gt(t,n))return;wf.set(n),i.uniformMatrix4fv(this.addr,!1,wf),Vt(t,n)}}function jy(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function Qy(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Gt(t,e))return;i.uniform2iv(this.addr,e),Vt(t,e)}}function ev(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Gt(t,e))return;i.uniform3iv(this.addr,e),Vt(t,e)}}function tv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Gt(t,e))return;i.uniform4iv(this.addr,e),Vt(t,e)}}function nv(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function iv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Gt(t,e))return;i.uniform2uiv(this.addr,e),Vt(t,e)}}function sv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Gt(t,e))return;i.uniform3uiv(this.addr,e),Vt(t,e)}}function rv(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Gt(t,e))return;i.uniform4uiv(this.addr,e),Vt(t,e)}}function ov(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r=this.type===i.SAMPLER_2D_SHADOW?Rp:Ap;t.setTexture2D(e||r,s)}function av(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||Pp,s)}function cv(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||Lp,s)}function lv(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||Cp,s)}function hv(i){switch(i){case 5126:return Xy;case 35664:return qy;case 35665:return Yy;case 35666:return Zy;case 35674:return Ky;case 35675:return $y;case 35676:return Jy;case 5124:case 35670:return jy;case 35667:case 35671:return Qy;case 35668:case 35672:return ev;case 35669:case 35673:return tv;case 5125:return nv;case 36294:return iv;case 36295:return sv;case 36296:return rv;case 35678:case 36198:case 36298:case 36306:case 35682:return ov;case 35679:case 36299:case 36307:return av;case 35680:case 36300:case 36308:case 36293:return cv;case 36289:case 36303:case 36311:case 36292:return lv}}function uv(i,e){i.uniform1fv(this.addr,e)}function dv(i,e){let t=Br(e,this.size,2);i.uniform2fv(this.addr,t)}function fv(i,e){let t=Br(e,this.size,3);i.uniform3fv(this.addr,t)}function pv(i,e){let t=Br(e,this.size,4);i.uniform4fv(this.addr,t)}function mv(i,e){let t=Br(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function gv(i,e){let t=Br(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function _v(i,e){let t=Br(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function xv(i,e){i.uniform1iv(this.addr,e)}function yv(i,e){i.uniform2iv(this.addr,e)}function vv(i,e){i.uniform3iv(this.addr,e)}function Mv(i,e){i.uniform4iv(this.addr,e)}function Sv(i,e){i.uniform1uiv(this.addr,e)}function Ev(i,e){i.uniform2uiv(this.addr,e)}function bv(i,e){i.uniform3uiv(this.addr,e)}function wv(i,e){i.uniform4uiv(this.addr,e)}function Tv(i,e,t){let n=this.cache,s=e.length,r=Cc(t,s);Gt(n,r)||(i.uniform1iv(this.addr,r),Vt(n,r));for(let o=0;o!==s;++o)t.setTexture2D(e[o]||Ap,r[o])}function Av(i,e,t){let n=this.cache,s=e.length,r=Cc(t,s);Gt(n,r)||(i.uniform1iv(this.addr,r),Vt(n,r));for(let o=0;o!==s;++o)t.setTexture3D(e[o]||Pp,r[o])}function Rv(i,e,t){let n=this.cache,s=e.length,r=Cc(t,s);Gt(n,r)||(i.uniform1iv(this.addr,r),Vt(n,r));for(let o=0;o!==s;++o)t.setTextureCube(e[o]||Lp,r[o])}function Cv(i,e,t){let n=this.cache,s=e.length,r=Cc(t,s);Gt(n,r)||(i.uniform1iv(this.addr,r),Vt(n,r));for(let o=0;o!==s;++o)t.setTexture2DArray(e[o]||Cp,r[o])}function Pv(i){switch(i){case 5126:return uv;case 35664:return dv;case 35665:return fv;case 35666:return pv;case 35674:return mv;case 35675:return gv;case 35676:return _v;case 5124:case 35670:return xv;case 35667:case 35671:return yv;case 35668:case 35672:return vv;case 35669:case 35673:return Mv;case 5125:return Sv;case 36294:return Ev;case 36295:return bv;case 36296:return wv;case 35678:case 36198:case 36298:case 36306:case 35682:return Tv;case 35679:case 36299:case 36307:return Av;case 35680:case 36300:case 36308:case 36293:return Rv;case 36289:case 36303:case 36311:case 36292:return Cv}}var nh=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=hv(t.type)}},ih=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Pv(t.type)}},sh=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let s=this.seq;for(let r=0,o=s.length;r!==o;++r){let a=s[r];a.setValue(e,t[a.id],n)}}},Ul=/(\w+)(\])?(\[|\.)?/g;function Rf(i,e){i.seq.push(e),i.map[e.id]=e}function Lv(i,e,t){let n=i.name,s=n.length;for(Ul.lastIndex=0;;){let r=Ul.exec(n),o=Ul.lastIndex,a=r[1],c=r[2]==="]",l=r[3];if(c&&(a=a|0),l===void 0||l==="["&&o+2===s){Rf(t,l===void 0?new nh(a,i,e):new ih(a,i,e));break}else{let u=t.map[a];u===void 0&&(u=new sh(a),Rf(t,u)),t=u}}}var Sr=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){let r=e.getActiveUniform(t,s),o=e.getUniformLocation(t,r.name);Lv(r,o,this)}}setValue(e,t,n,s){let r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){let s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,o=t.length;r!==o;++r){let a=t[r],c=n[a.id];c.needsUpdate!==!1&&a.setValue(e,c.value,s)}}static seqWithValue(e,t){let n=[];for(let s=0,r=e.length;s!==r;++s){let o=e[s];o.id in t&&n.push(o)}return n}};function Cf(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}var Iv=37297,Dv=0;function Nv(i,e){let t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let o=s;o<r;o++){let a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}function Uv(i){let e=ft.getPrimaries(ft.workingColorSpace),t=ft.getPrimaries(i),n;switch(e===t?n="":e===Va&&t===Ga?n="LinearDisplayP3ToLinearSRGB":e===Ga&&t===Va&&(n="LinearSRGBToLinearDisplayP3"),i){case Ht:case Rc:return[n,"LinearTransferOETF"];case _t:case zh:return[n,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space:",i),[n,"LinearTransferOETF"]}}function Pf(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),s=i.getShaderInfoLog(e).trim();if(n&&s==="")return"";let r=/ERROR: 0:(\d+)/.exec(s);if(r){let o=parseInt(r[1]);return t.toUpperCase()+`

`+s+`

`+Nv(i.getShaderSource(e),o)}else return s}function Ov(i,e){let t=Uv(e);return`vec4 ${i}( vec4 value ) { return ${t[0]}( ${t[1]}( value ) ); }`}function Fv(i,e){let t;switch(e){case kg:t="Linear";break;case zg:t="Reinhard";break;case Hg:t="OptimizedCineon";break;case Gg:t="ACESFilmic";break;case Wg:t="AgX";break;case Vg:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}function Bv(i){return[i.extensionDerivatives||i.envMapCubeUVHeight||i.bumpMap||i.normalMapTangentSpace||i.clearcoatNormalMap||i.flatShading||i.shaderID==="physical"?"#extension GL_OES_standard_derivatives : enable":"",(i.extensionFragDepth||i.logarithmicDepthBuffer)&&i.rendererExtensionFragDepth?"#extension GL_EXT_frag_depth : enable":"",i.extensionDrawBuffers&&i.rendererExtensionDrawBuffers?"#extension GL_EXT_draw_buffers : require":"",(i.extensionShaderTextureLOD||i.envMap||i.transmission)&&i.rendererExtensionShaderTextureLod?"#extension GL_EXT_shader_texture_lod : enable":""].filter(_r).join(`
`)}function kv(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":""].filter(_r).join(`
`)}function zv(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function Hv(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){let r=i.getActiveAttrib(e,s),o=r.name,a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),t[o]={type:r.type,location:i.getAttribLocation(e,o),locationSize:a}}return t}function _r(i){return i!==""}function Lf(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function If(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var Gv=/^[ \t]*#include +<([\w\d./]+)>/gm;function rh(i){return i.replace(Gv,Wv)}var Vv=new Map([["encodings_fragment","colorspace_fragment"],["encodings_pars_fragment","colorspace_pars_fragment"],["output_fragment","opaque_fragment"]]);function Wv(i,e){let t=Ze[e];if(t===void 0){let n=Vv.get(e);if(n!==void 0)t=Ze[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return rh(t)}var Xv=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Df(i){return i.replace(Xv,qv)}function qv(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function Nf(i){let e="precision "+i.precision+` float;
precision `+i.precision+" int;";return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function Yv(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===lp?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===Uh?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===Si&&(e="SHADOWMAP_TYPE_VSM"),e}function Zv(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case Er:case br:e="ENVMAP_TYPE_CUBE";break;case Tc:e="ENVMAP_TYPE_CUBE_UV";break}return e}function Kv(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case br:e="ENVMAP_MODE_REFRACTION";break}return e}function $v(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case hp:e="ENVMAP_BLENDING_MULTIPLY";break;case Fg:e="ENVMAP_BLENDING_MIX";break;case Bg:e="ENVMAP_BLENDING_ADD";break}return e}function Jv(i){let e=i.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:n,maxMip:t}}function jv(i,e,t,n){let s=i.getContext(),r=t.defines,o=t.vertexShader,a=t.fragmentShader,c=Yv(t),l=Zv(t),h=Kv(t),u=$v(t),d=Jv(t),f=t.isWebGL2?"":Bv(t),m=kv(t),_=zv(r),g=s.createProgram(),p,v,x=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(_r).join(`
`),p.length>0&&(p+=`
`),v=[f,"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(_r).join(`
`),v.length>0&&(v+=`
`)):(p=[Nf(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors&&t.isWebGL2?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_TEXTURE":"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.useLegacyLights?"#define LEGACY_LIGHTS":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.logarithmicDepthBuffer&&t.rendererExtensionFragDepth?"#define USE_LOGDEPTHBUF_EXT":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#if ( defined( USE_MORPHTARGETS ) && ! defined( MORPHTARGETS_TEXTURE ) )","	attribute vec3 morphTarget0;","	attribute vec3 morphTarget1;","	attribute vec3 morphTarget2;","	attribute vec3 morphTarget3;","	#ifdef USE_MORPHNORMALS","		attribute vec3 morphNormal0;","		attribute vec3 morphNormal1;","		attribute vec3 morphNormal2;","		attribute vec3 morphNormal3;","	#else","		attribute vec3 morphTarget4;","		attribute vec3 morphTarget5;","		attribute vec3 morphTarget6;","		attribute vec3 morphTarget7;","	#endif","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(_r).join(`
`),v=[f,Nf(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+l:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.useLegacyLights?"#define LEGACY_LIGHTS":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.logarithmicDepthBuffer&&t.rendererExtensionFragDepth?"#define USE_LOGDEPTHBUF_EXT":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==ri?"#define TONE_MAPPING":"",t.toneMapping!==ri?Ze.tonemapping_pars_fragment:"",t.toneMapping!==ri?Fv("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Ze.colorspace_pars_fragment,Ov("linearToOutputTexel",t.outputColorSpace),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(_r).join(`
`)),o=rh(o),o=Lf(o,t),o=If(o,t),a=rh(a),a=Lf(a,t),a=If(a,t),o=Df(o),a=Df(a),t.isWebGL2&&t.isRawShaderMaterial!==!0&&(x=`#version 300 es
`,p=[m,"precision mediump sampler2DArray;","#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+p,v=["precision mediump sampler2DArray;","#define varying in",t.glslVersion===jd?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===jd?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+v);let S=x+p+o,P=x+v+a,T=Cf(s,s.VERTEX_SHADER,S),R=Cf(s,s.FRAGMENT_SHADER,P);s.attachShader(g,T),s.attachShader(g,R),t.index0AttributeName!==void 0?s.bindAttribLocation(g,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(g,0,"position"),s.linkProgram(g);function F(q){if(i.debug.checkShaderErrors){let re=s.getProgramInfoLog(g).trim(),I=s.getShaderInfoLog(T).trim(),O=s.getShaderInfoLog(R).trim(),H=!0,K=!0;if(s.getProgramParameter(g,s.LINK_STATUS)===!1)if(H=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,g,T,R);else{let Y=Pf(s,T,"vertex"),V=Pf(s,R,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(g,s.VALIDATE_STATUS)+`

Program Info Log: `+re+`
`+Y+`
`+V)}else re!==""?console.warn("THREE.WebGLProgram: Program Info Log:",re):(I===""||O==="")&&(K=!1);K&&(q.diagnostics={runnable:H,programLog:re,vertexShader:{log:I,prefix:p},fragmentShader:{log:O,prefix:v}})}s.deleteShader(T),s.deleteShader(R),M=new Sr(s,g),w=Hv(s,g)}let M;this.getUniforms=function(){return M===void 0&&F(this),M};let w;this.getAttributes=function(){return w===void 0&&F(this),w};let U=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return U===!1&&(U=s.getProgramParameter(g,Iv)),U},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(g),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=Dv++,this.cacheKey=e,this.usedTimes=1,this.program=g,this.vertexShader=T,this.fragmentShader=R,this}var Qv=0,oh=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new ah(e),t.set(e,n)),n}},ah=class{constructor(e){this.id=Qv++,this.code=e,this.usedTimes=0}};function eM(i,e,t,n,s,r,o){let a=new Ao,c=new oh,l=[],h=s.isWebGL2,u=s.logarithmicDepthBuffer,d=s.vertexTextures,f=s.precision,m={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(M){return M===0?"uv":`uv${M}`}function g(M,w,U,q,re){let I=q.fog,O=re.geometry,H=M.isMeshStandardMaterial?q.environment:null,K=(M.isMeshStandardMaterial?t:e).get(M.envMap||H),Y=K&&K.mapping===Tc?K.image.height:null,V=m[M.type];M.precision!==null&&(f=s.getMaxPrecision(M.precision),f!==M.precision&&console.warn("THREE.WebGLProgram.getParameters:",M.precision,"not supported, using",f,"instead."));let ee=O.morphAttributes.position||O.morphAttributes.normal||O.morphAttributes.color,te=ee!==void 0?ee.length:0,me=0;O.morphAttributes.position!==void 0&&(me=1),O.morphAttributes.normal!==void 0&&(me=2),O.morphAttributes.color!==void 0&&(me=3);let G,J,ge,Ae;if(V){let fn=ii[V];G=fn.vertexShader,J=fn.fragmentShader}else G=M.vertexShader,J=M.fragmentShader,c.update(M),ge=c.getVertexShaderID(M),Ae=c.getFragmentShaderID(M);let ye=i.getRenderTarget(),Fe=re.isInstancedMesh===!0,Ve=re.isBatchedMesh===!0,Re=!!M.map,He=!!M.matcap,C=!!K,ce=!!M.aoMap,X=!!M.lightMap,oe=!!M.bumpMap,W=!!M.normalMap,Le=!!M.displacementMap,_e=!!M.emissiveMap,E=!!M.metalnessMap,y=!!M.roughnessMap,N=M.anisotropy>0,ne=M.clearcoat>0,j=M.iridescence>0,$=M.sheen>0,we=M.transmission>0,de=N&&!!M.anisotropyMap,ve=ne&&!!M.clearcoatMap,Ne=ne&&!!M.clearcoatNormalMap,Xe=ne&&!!M.clearcoatRoughnessMap,Q=j&&!!M.iridescenceMap,dt=j&&!!M.iridescenceThicknessMap,et=$&&!!M.sheenColorMap,Ge=$&&!!M.sheenRoughnessMap,Ie=!!M.specularMap,Se=!!M.specularColorMap,Ye=!!M.specularIntensityMap,mt=we&&!!M.transmissionMap,It=we&&!!M.thicknessMap,$e=!!M.gradientMap,le=!!M.alphaMap,L=M.alphaTest>0,fe=!!M.alphaHash,pe=!!M.extensions,Be=!!O.attributes.uv1,Ue=!!O.attributes.uv2,Mt=!!O.attributes.uv3,St=ri;return M.toneMapped&&(ye===null||ye.isXRRenderTarget===!0)&&(St=i.toneMapping),{isWebGL2:h,shaderID:V,shaderType:M.type,shaderName:M.name,vertexShader:G,fragmentShader:J,defines:M.defines,customVertexShaderID:ge,customFragmentShaderID:Ae,isRawShaderMaterial:M.isRawShaderMaterial===!0,glslVersion:M.glslVersion,precision:f,batching:Ve,instancing:Fe,instancingColor:Fe&&re.instanceColor!==null,supportsVertexTextures:d,outputColorSpace:ye===null?i.outputColorSpace:ye.isXRRenderTarget===!0?ye.texture.colorSpace:Ht,map:Re,matcap:He,envMap:C,envMapMode:C&&K.mapping,envMapCubeUVHeight:Y,aoMap:ce,lightMap:X,bumpMap:oe,normalMap:W,displacementMap:d&&Le,emissiveMap:_e,normalMapObjectSpace:W&&M.normalMapType===r0,normalMapTangentSpace:W&&M.normalMapType===Mp,metalnessMap:E,roughnessMap:y,anisotropy:N,anisotropyMap:de,clearcoat:ne,clearcoatMap:ve,clearcoatNormalMap:Ne,clearcoatRoughnessMap:Xe,iridescence:j,iridescenceMap:Q,iridescenceThicknessMap:dt,sheen:$,sheenColorMap:et,sheenRoughnessMap:Ge,specularMap:Ie,specularColorMap:Se,specularIntensityMap:Ye,transmission:we,transmissionMap:mt,thicknessMap:It,gradientMap:$e,opaque:M.transparent===!1&&M.blending===yr,alphaMap:le,alphaTest:L,alphaHash:fe,combine:M.combine,mapUv:Re&&_(M.map.channel),aoMapUv:ce&&_(M.aoMap.channel),lightMapUv:X&&_(M.lightMap.channel),bumpMapUv:oe&&_(M.bumpMap.channel),normalMapUv:W&&_(M.normalMap.channel),displacementMapUv:Le&&_(M.displacementMap.channel),emissiveMapUv:_e&&_(M.emissiveMap.channel),metalnessMapUv:E&&_(M.metalnessMap.channel),roughnessMapUv:y&&_(M.roughnessMap.channel),anisotropyMapUv:de&&_(M.anisotropyMap.channel),clearcoatMapUv:ve&&_(M.clearcoatMap.channel),clearcoatNormalMapUv:Ne&&_(M.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Xe&&_(M.clearcoatRoughnessMap.channel),iridescenceMapUv:Q&&_(M.iridescenceMap.channel),iridescenceThicknessMapUv:dt&&_(M.iridescenceThicknessMap.channel),sheenColorMapUv:et&&_(M.sheenColorMap.channel),sheenRoughnessMapUv:Ge&&_(M.sheenRoughnessMap.channel),specularMapUv:Ie&&_(M.specularMap.channel),specularColorMapUv:Se&&_(M.specularColorMap.channel),specularIntensityMapUv:Ye&&_(M.specularIntensityMap.channel),transmissionMapUv:mt&&_(M.transmissionMap.channel),thicknessMapUv:It&&_(M.thicknessMap.channel),alphaMapUv:le&&_(M.alphaMap.channel),vertexTangents:!!O.attributes.tangent&&(W||N),vertexColors:M.vertexColors,vertexAlphas:M.vertexColors===!0&&!!O.attributes.color&&O.attributes.color.itemSize===4,vertexUv1s:Be,vertexUv2s:Ue,vertexUv3s:Mt,pointsUvs:re.isPoints===!0&&!!O.attributes.uv&&(Re||le),fog:!!I,useFog:M.fog===!0,fogExp2:I&&I.isFogExp2,flatShading:M.flatShading===!0,sizeAttenuation:M.sizeAttenuation===!0,logarithmicDepthBuffer:u,skinning:re.isSkinnedMesh===!0,morphTargets:O.morphAttributes.position!==void 0,morphNormals:O.morphAttributes.normal!==void 0,morphColors:O.morphAttributes.color!==void 0,morphTargetsCount:te,morphTextureStride:me,numDirLights:w.directional.length,numPointLights:w.point.length,numSpotLights:w.spot.length,numSpotLightMaps:w.spotLightMap.length,numRectAreaLights:w.rectArea.length,numHemiLights:w.hemi.length,numDirLightShadows:w.directionalShadowMap.length,numPointLightShadows:w.pointShadowMap.length,numSpotLightShadows:w.spotShadowMap.length,numSpotLightShadowsWithMaps:w.numSpotLightShadowsWithMaps,numLightProbes:w.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:M.dithering,shadowMapEnabled:i.shadowMap.enabled&&U.length>0,shadowMapType:i.shadowMap.type,toneMapping:St,useLegacyLights:i._useLegacyLights,decodeVideoTexture:Re&&M.map.isVideoTexture===!0&&ft.getTransfer(M.map.colorSpace)===wt,premultipliedAlpha:M.premultipliedAlpha,doubleSided:M.side===Jt,flipSided:M.side===Mn,useDepthPacking:M.depthPacking>=0,depthPacking:M.depthPacking||0,index0AttributeName:M.index0AttributeName,extensionDerivatives:pe&&M.extensions.derivatives===!0,extensionFragDepth:pe&&M.extensions.fragDepth===!0,extensionDrawBuffers:pe&&M.extensions.drawBuffers===!0,extensionShaderTextureLOD:pe&&M.extensions.shaderTextureLOD===!0,extensionClipCullDistance:pe&&M.extensions.clipCullDistance&&n.has("WEBGL_clip_cull_distance"),rendererExtensionFragDepth:h||n.has("EXT_frag_depth"),rendererExtensionDrawBuffers:h||n.has("WEBGL_draw_buffers"),rendererExtensionShaderTextureLod:h||n.has("EXT_shader_texture_lod"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:M.customProgramCacheKey()}}function p(M){let w=[];if(M.shaderID?w.push(M.shaderID):(w.push(M.customVertexShaderID),w.push(M.customFragmentShaderID)),M.defines!==void 0)for(let U in M.defines)w.push(U),w.push(M.defines[U]);return M.isRawShaderMaterial===!1&&(v(w,M),x(w,M),w.push(i.outputColorSpace)),w.push(M.customProgramCacheKey),w.join()}function v(M,w){M.push(w.precision),M.push(w.outputColorSpace),M.push(w.envMapMode),M.push(w.envMapCubeUVHeight),M.push(w.mapUv),M.push(w.alphaMapUv),M.push(w.lightMapUv),M.push(w.aoMapUv),M.push(w.bumpMapUv),M.push(w.normalMapUv),M.push(w.displacementMapUv),M.push(w.emissiveMapUv),M.push(w.metalnessMapUv),M.push(w.roughnessMapUv),M.push(w.anisotropyMapUv),M.push(w.clearcoatMapUv),M.push(w.clearcoatNormalMapUv),M.push(w.clearcoatRoughnessMapUv),M.push(w.iridescenceMapUv),M.push(w.iridescenceThicknessMapUv),M.push(w.sheenColorMapUv),M.push(w.sheenRoughnessMapUv),M.push(w.specularMapUv),M.push(w.specularColorMapUv),M.push(w.specularIntensityMapUv),M.push(w.transmissionMapUv),M.push(w.thicknessMapUv),M.push(w.combine),M.push(w.fogExp2),M.push(w.sizeAttenuation),M.push(w.morphTargetsCount),M.push(w.morphAttributeCount),M.push(w.numDirLights),M.push(w.numPointLights),M.push(w.numSpotLights),M.push(w.numSpotLightMaps),M.push(w.numHemiLights),M.push(w.numRectAreaLights),M.push(w.numDirLightShadows),M.push(w.numPointLightShadows),M.push(w.numSpotLightShadows),M.push(w.numSpotLightShadowsWithMaps),M.push(w.numLightProbes),M.push(w.shadowMapType),M.push(w.toneMapping),M.push(w.numClippingPlanes),M.push(w.numClipIntersection),M.push(w.depthPacking)}function x(M,w){a.disableAll(),w.isWebGL2&&a.enable(0),w.supportsVertexTextures&&a.enable(1),w.instancing&&a.enable(2),w.instancingColor&&a.enable(3),w.matcap&&a.enable(4),w.envMap&&a.enable(5),w.normalMapObjectSpace&&a.enable(6),w.normalMapTangentSpace&&a.enable(7),w.clearcoat&&a.enable(8),w.iridescence&&a.enable(9),w.alphaTest&&a.enable(10),w.vertexColors&&a.enable(11),w.vertexAlphas&&a.enable(12),w.vertexUv1s&&a.enable(13),w.vertexUv2s&&a.enable(14),w.vertexUv3s&&a.enable(15),w.vertexTangents&&a.enable(16),w.anisotropy&&a.enable(17),w.alphaHash&&a.enable(18),w.batching&&a.enable(19),M.push(a.mask),a.disableAll(),w.fog&&a.enable(0),w.useFog&&a.enable(1),w.flatShading&&a.enable(2),w.logarithmicDepthBuffer&&a.enable(3),w.skinning&&a.enable(4),w.morphTargets&&a.enable(5),w.morphNormals&&a.enable(6),w.morphColors&&a.enable(7),w.premultipliedAlpha&&a.enable(8),w.shadowMapEnabled&&a.enable(9),w.useLegacyLights&&a.enable(10),w.doubleSided&&a.enable(11),w.flipSided&&a.enable(12),w.useDepthPacking&&a.enable(13),w.dithering&&a.enable(14),w.transmission&&a.enable(15),w.sheen&&a.enable(16),w.opaque&&a.enable(17),w.pointsUvs&&a.enable(18),w.decodeVideoTexture&&a.enable(19),M.push(a.mask)}function S(M){let w=m[M.type],U;if(w){let q=ii[w];U=V0.clone(q.uniforms)}else U=M.uniforms;return U}function P(M,w){let U;for(let q=0,re=l.length;q<re;q++){let I=l[q];if(I.cacheKey===w){U=I,++U.usedTimes;break}}return U===void 0&&(U=new jv(i,w,M,r),l.push(U)),U}function T(M){if(--M.usedTimes===0){let w=l.indexOf(M);l[w]=l[l.length-1],l.pop(),M.destroy()}}function R(M){c.remove(M)}function F(){c.dispose()}return{getParameters:g,getProgramCacheKey:p,getUniforms:S,acquireProgram:P,releaseProgram:T,releaseShaderCache:R,programs:l,dispose:F}}function tM(){let i=new WeakMap;function e(r){let o=i.get(r);return o===void 0&&(o={},i.set(r,o)),o}function t(r){i.delete(r)}function n(r,o,a){i.get(r)[o]=a}function s(){i=new WeakMap}return{get:e,remove:t,update:n,dispose:s}}function nM(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function Uf(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function Of(){let i=[],e=0,t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function o(u,d,f,m,_,g){let p=i[e];return p===void 0?(p={id:u.id,object:u,geometry:d,material:f,groupOrder:m,renderOrder:u.renderOrder,z:_,group:g},i[e]=p):(p.id=u.id,p.object=u,p.geometry=d,p.material=f,p.groupOrder=m,p.renderOrder=u.renderOrder,p.z=_,p.group=g),e++,p}function a(u,d,f,m,_,g){let p=o(u,d,f,m,_,g);f.transmission>0?n.push(p):f.transparent===!0?s.push(p):t.push(p)}function c(u,d,f,m,_,g){let p=o(u,d,f,m,_,g);f.transmission>0?n.unshift(p):f.transparent===!0?s.unshift(p):t.unshift(p)}function l(u,d){t.length>1&&t.sort(u||nM),n.length>1&&n.sort(d||Uf),s.length>1&&s.sort(d||Uf)}function h(){for(let u=e,d=i.length;u<d;u++){let f=i[u];if(f.id===null)break;f.id=null,f.object=null,f.geometry=null,f.material=null,f.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:a,unshift:c,finish:h,sort:l}}function iM(){let i=new WeakMap;function e(n,s){let r=i.get(n),o;return r===void 0?(o=new Of,i.set(n,[o])):s>=r.length?(o=new Of,r.push(o)):o=r[s],o}function t(){i=new WeakMap}return{get:e,dispose:t}}function sM(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new A,color:new Ee};break;case"SpotLight":t={position:new A,direction:new A,color:new Ee,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new A,color:new Ee,distance:0,decay:0};break;case"HemisphereLight":t={direction:new A,skyColor:new Ee,groundColor:new Ee};break;case"RectAreaLight":t={color:new Ee,position:new A,halfWidth:new A,halfHeight:new A};break}return i[e.id]=t,t}}}function rM(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new se};break;case"SpotLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new se};break;case"PointLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new se,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}var oM=0;function aM(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function cM(i,e){let t=new sM,n=rM(),s={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let h=0;h<9;h++)s.probe.push(new A);let r=new A,o=new De,a=new De;function c(h,u){let d=0,f=0,m=0;for(let q=0;q<9;q++)s.probe[q].set(0,0,0);let _=0,g=0,p=0,v=0,x=0,S=0,P=0,T=0,R=0,F=0,M=0;h.sort(aM);let w=u===!0?Math.PI:1;for(let q=0,re=h.length;q<re;q++){let I=h[q],O=I.color,H=I.intensity,K=I.distance,Y=I.shadow&&I.shadow.map?I.shadow.map.texture:null;if(I.isAmbientLight)d+=O.r*H*w,f+=O.g*H*w,m+=O.b*H*w;else if(I.isLightProbe){for(let V=0;V<9;V++)s.probe[V].addScaledVector(I.sh.coefficients[V],H);M++}else if(I.isDirectionalLight){let V=t.get(I);if(V.color.copy(I.color).multiplyScalar(I.intensity*w),I.castShadow){let ee=I.shadow,te=n.get(I);te.shadowBias=ee.bias,te.shadowNormalBias=ee.normalBias,te.shadowRadius=ee.radius,te.shadowMapSize=ee.mapSize,s.directionalShadow[_]=te,s.directionalShadowMap[_]=Y,s.directionalShadowMatrix[_]=I.shadow.matrix,S++}s.directional[_]=V,_++}else if(I.isSpotLight){let V=t.get(I);V.position.setFromMatrixPosition(I.matrixWorld),V.color.copy(O).multiplyScalar(H*w),V.distance=K,V.coneCos=Math.cos(I.angle),V.penumbraCos=Math.cos(I.angle*(1-I.penumbra)),V.decay=I.decay,s.spot[p]=V;let ee=I.shadow;if(I.map&&(s.spotLightMap[R]=I.map,R++,ee.updateMatrices(I),I.castShadow&&F++),s.spotLightMatrix[p]=ee.matrix,I.castShadow){let te=n.get(I);te.shadowBias=ee.bias,te.shadowNormalBias=ee.normalBias,te.shadowRadius=ee.radius,te.shadowMapSize=ee.mapSize,s.spotShadow[p]=te,s.spotShadowMap[p]=Y,T++}p++}else if(I.isRectAreaLight){let V=t.get(I);V.color.copy(O).multiplyScalar(H),V.halfWidth.set(I.width*.5,0,0),V.halfHeight.set(0,I.height*.5,0),s.rectArea[v]=V,v++}else if(I.isPointLight){let V=t.get(I);if(V.color.copy(I.color).multiplyScalar(I.intensity*w),V.distance=I.distance,V.decay=I.decay,I.castShadow){let ee=I.shadow,te=n.get(I);te.shadowBias=ee.bias,te.shadowNormalBias=ee.normalBias,te.shadowRadius=ee.radius,te.shadowMapSize=ee.mapSize,te.shadowCameraNear=ee.camera.near,te.shadowCameraFar=ee.camera.far,s.pointShadow[g]=te,s.pointShadowMap[g]=Y,s.pointShadowMatrix[g]=I.shadow.matrix,P++}s.point[g]=V,g++}else if(I.isHemisphereLight){let V=t.get(I);V.skyColor.copy(I.color).multiplyScalar(H*w),V.groundColor.copy(I.groundColor).multiplyScalar(H*w),s.hemi[x]=V,x++}}v>0&&(e.isWebGL2?i.has("OES_texture_float_linear")===!0?(s.rectAreaLTC1=he.LTC_FLOAT_1,s.rectAreaLTC2=he.LTC_FLOAT_2):(s.rectAreaLTC1=he.LTC_HALF_1,s.rectAreaLTC2=he.LTC_HALF_2):i.has("OES_texture_float_linear")===!0?(s.rectAreaLTC1=he.LTC_FLOAT_1,s.rectAreaLTC2=he.LTC_FLOAT_2):i.has("OES_texture_half_float_linear")===!0?(s.rectAreaLTC1=he.LTC_HALF_1,s.rectAreaLTC2=he.LTC_HALF_2):console.error("THREE.WebGLRenderer: Unable to use RectAreaLight. Missing WebGL extensions.")),s.ambient[0]=d,s.ambient[1]=f,s.ambient[2]=m;let U=s.hash;(U.directionalLength!==_||U.pointLength!==g||U.spotLength!==p||U.rectAreaLength!==v||U.hemiLength!==x||U.numDirectionalShadows!==S||U.numPointShadows!==P||U.numSpotShadows!==T||U.numSpotMaps!==R||U.numLightProbes!==M)&&(s.directional.length=_,s.spot.length=p,s.rectArea.length=v,s.point.length=g,s.hemi.length=x,s.directionalShadow.length=S,s.directionalShadowMap.length=S,s.pointShadow.length=P,s.pointShadowMap.length=P,s.spotShadow.length=T,s.spotShadowMap.length=T,s.directionalShadowMatrix.length=S,s.pointShadowMatrix.length=P,s.spotLightMatrix.length=T+R-F,s.spotLightMap.length=R,s.numSpotLightShadowsWithMaps=F,s.numLightProbes=M,U.directionalLength=_,U.pointLength=g,U.spotLength=p,U.rectAreaLength=v,U.hemiLength=x,U.numDirectionalShadows=S,U.numPointShadows=P,U.numSpotShadows=T,U.numSpotMaps=R,U.numLightProbes=M,s.version=oM++)}function l(h,u){let d=0,f=0,m=0,_=0,g=0,p=u.matrixWorldInverse;for(let v=0,x=h.length;v<x;v++){let S=h[v];if(S.isDirectionalLight){let P=s.directional[d];P.direction.setFromMatrixPosition(S.matrixWorld),r.setFromMatrixPosition(S.target.matrixWorld),P.direction.sub(r),P.direction.transformDirection(p),d++}else if(S.isSpotLight){let P=s.spot[m];P.position.setFromMatrixPosition(S.matrixWorld),P.position.applyMatrix4(p),P.direction.setFromMatrixPosition(S.matrixWorld),r.setFromMatrixPosition(S.target.matrixWorld),P.direction.sub(r),P.direction.transformDirection(p),m++}else if(S.isRectAreaLight){let P=s.rectArea[_];P.position.setFromMatrixPosition(S.matrixWorld),P.position.applyMatrix4(p),a.identity(),o.copy(S.matrixWorld),o.premultiply(p),a.extractRotation(o),P.halfWidth.set(S.width*.5,0,0),P.halfHeight.set(0,S.height*.5,0),P.halfWidth.applyMatrix4(a),P.halfHeight.applyMatrix4(a),_++}else if(S.isPointLight){let P=s.point[f];P.position.setFromMatrixPosition(S.matrixWorld),P.position.applyMatrix4(p),f++}else if(S.isHemisphereLight){let P=s.hemi[g];P.direction.setFromMatrixPosition(S.matrixWorld),P.direction.transformDirection(p),g++}}}return{setup:c,setupView:l,state:s}}function Ff(i,e){let t=new cM(i,e),n=[],s=[];function r(){n.length=0,s.length=0}function o(u){n.push(u)}function a(u){s.push(u)}function c(u){t.setup(n,u)}function l(u){t.setupView(n,u)}return{init:r,state:{lightsArray:n,shadowsArray:s,lights:t},setupLights:c,setupLightsView:l,pushLight:o,pushShadow:a}}function lM(i,e){let t=new WeakMap;function n(r,o=0){let a=t.get(r),c;return a===void 0?(c=new Ff(i,e),t.set(r,[c])):o>=a.length?(c=new Ff(i,e),a.push(c)):c=a[o],c}function s(){t=new WeakMap}return{get:n,dispose:s}}var ch=class extends Ln{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=i0,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},lh=class extends Ln{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}},hM=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,uM=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function dM(i,e,t){let n=new Ro,s=new se,r=new se,o=new yt,a=new ch({depthPacking:s0}),c=new lh,l={},h=t.maxTextureSize,u={[oi]:Mn,[Mn]:oi,[Jt]:Jt},d=new Ci({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new se},radius:{value:4}},vertexShader:hM,fragmentShader:uM}),f=d.clone();f.defines.HORIZONTAL_PASS=1;let m=new Lt;m.setAttribute("position",new Ot(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let _=new ae(m,d),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=lp;let p=this.type;this.render=function(T,R,F){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||T.length===0)return;let M=i.getRenderTarget(),w=i.getActiveCubeFace(),U=i.getActiveMipmapLevel(),q=i.state;q.setBlending(qi),q.buffers.color.setClear(1,1,1,1),q.buffers.depth.setTest(!0),q.setScissorTest(!1);let re=p!==Si&&this.type===Si,I=p===Si&&this.type!==Si;for(let O=0,H=T.length;O<H;O++){let K=T[O],Y=K.shadow;if(Y===void 0){console.warn("THREE.WebGLShadowMap:",K,"has no shadow.");continue}if(Y.autoUpdate===!1&&Y.needsUpdate===!1)continue;s.copy(Y.mapSize);let V=Y.getFrameExtents();if(s.multiply(V),r.copy(Y.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/V.x),s.x=r.x*V.x,Y.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/V.y),s.y=r.y*V.y,Y.mapSize.y=r.y)),Y.map===null||re===!0||I===!0){let te=this.type!==Si?{minFilter:zt,magFilter:zt}:{};Y.map!==null&&Y.map.dispose(),Y.map=new Ri(s.x,s.y,te),Y.map.texture.name=K.name+".shadowMap",Y.camera.updateProjectionMatrix()}i.setRenderTarget(Y.map),i.clear();let ee=Y.getViewportCount();for(let te=0;te<ee;te++){let me=Y.getViewport(te);o.set(r.x*me.x,r.y*me.y,r.x*me.z,r.y*me.w),q.viewport(o),Y.updateMatrices(K,te),n=Y.getFrustum(),S(R,F,Y.camera,K,this.type)}Y.isPointLightShadow!==!0&&this.type===Si&&v(Y,F),Y.needsUpdate=!1}p=this.type,g.needsUpdate=!1,i.setRenderTarget(M,w,U)};function v(T,R){let F=e.update(_);d.defines.VSM_SAMPLES!==T.blurSamples&&(d.defines.VSM_SAMPLES=T.blurSamples,f.defines.VSM_SAMPLES=T.blurSamples,d.needsUpdate=!0,f.needsUpdate=!0),T.mapPass===null&&(T.mapPass=new Ri(s.x,s.y)),d.uniforms.shadow_pass.value=T.map.texture,d.uniforms.resolution.value=T.mapSize,d.uniforms.radius.value=T.radius,i.setRenderTarget(T.mapPass),i.clear(),i.renderBufferDirect(R,null,F,d,_,null),f.uniforms.shadow_pass.value=T.mapPass.texture,f.uniforms.resolution.value=T.mapSize,f.uniforms.radius.value=T.radius,i.setRenderTarget(T.map),i.clear(),i.renderBufferDirect(R,null,F,f,_,null)}function x(T,R,F,M){let w=null,U=F.isPointLight===!0?T.customDistanceMaterial:T.customDepthMaterial;if(U!==void 0)w=U;else if(w=F.isPointLight===!0?c:a,i.localClippingEnabled&&R.clipShadows===!0&&Array.isArray(R.clippingPlanes)&&R.clippingPlanes.length!==0||R.displacementMap&&R.displacementScale!==0||R.alphaMap&&R.alphaTest>0||R.map&&R.alphaTest>0){let q=w.uuid,re=R.uuid,I=l[q];I===void 0&&(I={},l[q]=I);let O=I[re];O===void 0&&(O=w.clone(),I[re]=O,R.addEventListener("dispose",P)),w=O}if(w.visible=R.visible,w.wireframe=R.wireframe,M===Si?w.side=R.shadowSide!==null?R.shadowSide:R.side:w.side=R.shadowSide!==null?R.shadowSide:u[R.side],w.alphaMap=R.alphaMap,w.alphaTest=R.alphaTest,w.map=R.map,w.clipShadows=R.clipShadows,w.clippingPlanes=R.clippingPlanes,w.clipIntersection=R.clipIntersection,w.displacementMap=R.displacementMap,w.displacementScale=R.displacementScale,w.displacementBias=R.displacementBias,w.wireframeLinewidth=R.wireframeLinewidth,w.linewidth=R.linewidth,F.isPointLight===!0&&w.isMeshDistanceMaterial===!0){let q=i.properties.get(w);q.light=F}return w}function S(T,R,F,M,w){if(T.visible===!1)return;if(T.layers.test(R.layers)&&(T.isMesh||T.isLine||T.isPoints)&&(T.castShadow||T.receiveShadow&&w===Si)&&(!T.frustumCulled||n.intersectsObject(T))){T.modelViewMatrix.multiplyMatrices(F.matrixWorldInverse,T.matrixWorld);let re=e.update(T),I=T.material;if(Array.isArray(I)){let O=re.groups;for(let H=0,K=O.length;H<K;H++){let Y=O[H],V=I[Y.materialIndex];if(V&&V.visible){let ee=x(T,V,M,w);T.onBeforeShadow(i,T,R,F,re,ee,Y),i.renderBufferDirect(F,null,re,ee,T,Y),T.onAfterShadow(i,T,R,F,re,ee,Y)}}}else if(I.visible){let O=x(T,I,M,w);T.onBeforeShadow(i,T,R,F,re,O,null),i.renderBufferDirect(F,null,re,O,T,null),T.onAfterShadow(i,T,R,F,re,O,null)}}let q=T.children;for(let re=0,I=q.length;re<I;re++)S(q[re],R,F,M,w)}function P(T){T.target.removeEventListener("dispose",P);for(let F in l){let M=l[F],w=T.target.uuid;w in M&&(M[w].dispose(),delete M[w])}}}function fM(i,e,t){let n=t.isWebGL2;function s(){let L=!1,fe=new yt,pe=null,Be=new yt(0,0,0,0);return{setMask:function(Ue){pe!==Ue&&!L&&(i.colorMask(Ue,Ue,Ue,Ue),pe=Ue)},setLocked:function(Ue){L=Ue},setClear:function(Ue,Mt,St,Yt,fn){fn===!0&&(Ue*=Yt,Mt*=Yt,St*=Yt),fe.set(Ue,Mt,St,Yt),Be.equals(fe)===!1&&(i.clearColor(Ue,Mt,St,Yt),Be.copy(fe))},reset:function(){L=!1,pe=null,Be.set(-1,0,0,0)}}}function r(){let L=!1,fe=null,pe=null,Be=null;return{setTest:function(Ue){Ue?Ve(i.DEPTH_TEST):Re(i.DEPTH_TEST)},setMask:function(Ue){fe!==Ue&&!L&&(i.depthMask(Ue),fe=Ue)},setFunc:function(Ue){if(pe!==Ue){switch(Ue){case Pg:i.depthFunc(i.NEVER);break;case Lg:i.depthFunc(i.ALWAYS);break;case Ig:i.depthFunc(i.LESS);break;case Ba:i.depthFunc(i.LEQUAL);break;case Dg:i.depthFunc(i.EQUAL);break;case Ng:i.depthFunc(i.GEQUAL);break;case Ug:i.depthFunc(i.GREATER);break;case Og:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}pe=Ue}},setLocked:function(Ue){L=Ue},setClear:function(Ue){Be!==Ue&&(i.clearDepth(Ue),Be=Ue)},reset:function(){L=!1,fe=null,pe=null,Be=null}}}function o(){let L=!1,fe=null,pe=null,Be=null,Ue=null,Mt=null,St=null,Yt=null,fn=null;return{setTest:function(Et){L||(Et?Ve(i.STENCIL_TEST):Re(i.STENCIL_TEST))},setMask:function(Et){fe!==Et&&!L&&(i.stencilMask(Et),fe=Et)},setFunc:function(Et,pn,ni){(pe!==Et||Be!==pn||Ue!==ni)&&(i.stencilFunc(Et,pn,ni),pe=Et,Be=pn,Ue=ni)},setOp:function(Et,pn,ni){(Mt!==Et||St!==pn||Yt!==ni)&&(i.stencilOp(Et,pn,ni),Mt=Et,St=pn,Yt=ni)},setLocked:function(Et){L=Et},setClear:function(Et){fn!==Et&&(i.clearStencil(Et),fn=Et)},reset:function(){L=!1,fe=null,pe=null,Be=null,Ue=null,Mt=null,St=null,Yt=null,fn=null}}}let a=new s,c=new r,l=new o,h=new WeakMap,u=new WeakMap,d={},f={},m=new WeakMap,_=[],g=null,p=!1,v=null,x=null,S=null,P=null,T=null,R=null,F=null,M=new Ee(0,0,0),w=0,U=!1,q=null,re=null,I=null,O=null,H=null,K=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),Y=!1,V=0,ee=i.getParameter(i.VERSION);ee.indexOf("WebGL")!==-1?(V=parseFloat(/^WebGL (\d)/.exec(ee)[1]),Y=V>=1):ee.indexOf("OpenGL ES")!==-1&&(V=parseFloat(/^OpenGL ES (\d)/.exec(ee)[1]),Y=V>=2);let te=null,me={},G=i.getParameter(i.SCISSOR_BOX),J=i.getParameter(i.VIEWPORT),ge=new yt().fromArray(G),Ae=new yt().fromArray(J);function ye(L,fe,pe,Be){let Ue=new Uint8Array(4),Mt=i.createTexture();i.bindTexture(L,Mt),i.texParameteri(L,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(L,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let St=0;St<pe;St++)n&&(L===i.TEXTURE_3D||L===i.TEXTURE_2D_ARRAY)?i.texImage3D(fe,0,i.RGBA,1,1,Be,0,i.RGBA,i.UNSIGNED_BYTE,Ue):i.texImage2D(fe+St,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,Ue);return Mt}let Fe={};Fe[i.TEXTURE_2D]=ye(i.TEXTURE_2D,i.TEXTURE_2D,1),Fe[i.TEXTURE_CUBE_MAP]=ye(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),n&&(Fe[i.TEXTURE_2D_ARRAY]=ye(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),Fe[i.TEXTURE_3D]=ye(i.TEXTURE_3D,i.TEXTURE_3D,1,1)),a.setClear(0,0,0,1),c.setClear(1),l.setClear(0),Ve(i.DEPTH_TEST),c.setFunc(Ba),_e(!1),E(yd),Ve(i.CULL_FACE),W(qi);function Ve(L){d[L]!==!0&&(i.enable(L),d[L]=!0)}function Re(L){d[L]!==!1&&(i.disable(L),d[L]=!1)}function He(L,fe){return f[L]!==fe?(i.bindFramebuffer(L,fe),f[L]=fe,n&&(L===i.DRAW_FRAMEBUFFER&&(f[i.FRAMEBUFFER]=fe),L===i.FRAMEBUFFER&&(f[i.DRAW_FRAMEBUFFER]=fe)),!0):!1}function C(L,fe){let pe=_,Be=!1;if(L)if(pe=m.get(fe),pe===void 0&&(pe=[],m.set(fe,pe)),L.isWebGLMultipleRenderTargets){let Ue=L.texture;if(pe.length!==Ue.length||pe[0]!==i.COLOR_ATTACHMENT0){for(let Mt=0,St=Ue.length;Mt<St;Mt++)pe[Mt]=i.COLOR_ATTACHMENT0+Mt;pe.length=Ue.length,Be=!0}}else pe[0]!==i.COLOR_ATTACHMENT0&&(pe[0]=i.COLOR_ATTACHMENT0,Be=!0);else pe[0]!==i.BACK&&(pe[0]=i.BACK,Be=!0);Be&&(t.isWebGL2?i.drawBuffers(pe):e.get("WEBGL_draw_buffers").drawBuffersWEBGL(pe))}function ce(L){return g!==L?(i.useProgram(L),g=L,!0):!1}let X={[Ss]:i.FUNC_ADD,[mg]:i.FUNC_SUBTRACT,[gg]:i.FUNC_REVERSE_SUBTRACT};if(n)X[Ed]=i.MIN,X[bd]=i.MAX;else{let L=e.get("EXT_blend_minmax");L!==null&&(X[Ed]=L.MIN_EXT,X[bd]=L.MAX_EXT)}let oe={[_g]:i.ZERO,[xg]:i.ONE,[yg]:i.SRC_COLOR,[Xl]:i.SRC_ALPHA,[wg]:i.SRC_ALPHA_SATURATE,[Eg]:i.DST_COLOR,[Mg]:i.DST_ALPHA,[vg]:i.ONE_MINUS_SRC_COLOR,[ql]:i.ONE_MINUS_SRC_ALPHA,[bg]:i.ONE_MINUS_DST_COLOR,[Sg]:i.ONE_MINUS_DST_ALPHA,[Tg]:i.CONSTANT_COLOR,[Ag]:i.ONE_MINUS_CONSTANT_COLOR,[Rg]:i.CONSTANT_ALPHA,[Cg]:i.ONE_MINUS_CONSTANT_ALPHA};function W(L,fe,pe,Be,Ue,Mt,St,Yt,fn,Et){if(L===qi){p===!0&&(Re(i.BLEND),p=!1);return}if(p===!1&&(Ve(i.BLEND),p=!0),L!==pg){if(L!==v||Et!==U){if((x!==Ss||T!==Ss)&&(i.blendEquation(i.FUNC_ADD),x=Ss,T=Ss),Et)switch(L){case yr:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case vd:i.blendFunc(i.ONE,i.ONE);break;case Md:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case Sd:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",L);break}else switch(L){case yr:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case vd:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case Md:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case Sd:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",L);break}S=null,P=null,R=null,F=null,M.set(0,0,0),w=0,v=L,U=Et}return}Ue=Ue||fe,Mt=Mt||pe,St=St||Be,(fe!==x||Ue!==T)&&(i.blendEquationSeparate(X[fe],X[Ue]),x=fe,T=Ue),(pe!==S||Be!==P||Mt!==R||St!==F)&&(i.blendFuncSeparate(oe[pe],oe[Be],oe[Mt],oe[St]),S=pe,P=Be,R=Mt,F=St),(Yt.equals(M)===!1||fn!==w)&&(i.blendColor(Yt.r,Yt.g,Yt.b,fn),M.copy(Yt),w=fn),v=L,U=!1}function Le(L,fe){L.side===Jt?Re(i.CULL_FACE):Ve(i.CULL_FACE);let pe=L.side===Mn;fe&&(pe=!pe),_e(pe),L.blending===yr&&L.transparent===!1?W(qi):W(L.blending,L.blendEquation,L.blendSrc,L.blendDst,L.blendEquationAlpha,L.blendSrcAlpha,L.blendDstAlpha,L.blendColor,L.blendAlpha,L.premultipliedAlpha),c.setFunc(L.depthFunc),c.setTest(L.depthTest),c.setMask(L.depthWrite),a.setMask(L.colorWrite);let Be=L.stencilWrite;l.setTest(Be),Be&&(l.setMask(L.stencilWriteMask),l.setFunc(L.stencilFunc,L.stencilRef,L.stencilFuncMask),l.setOp(L.stencilFail,L.stencilZFail,L.stencilZPass)),N(L.polygonOffset,L.polygonOffsetFactor,L.polygonOffsetUnits),L.alphaToCoverage===!0?Ve(i.SAMPLE_ALPHA_TO_COVERAGE):Re(i.SAMPLE_ALPHA_TO_COVERAGE)}function _e(L){q!==L&&(L?i.frontFace(i.CW):i.frontFace(i.CCW),q=L)}function E(L){L!==dg?(Ve(i.CULL_FACE),L!==re&&(L===yd?i.cullFace(i.BACK):L===fg?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Re(i.CULL_FACE),re=L}function y(L){L!==I&&(Y&&i.lineWidth(L),I=L)}function N(L,fe,pe){L?(Ve(i.POLYGON_OFFSET_FILL),(O!==fe||H!==pe)&&(i.polygonOffset(fe,pe),O=fe,H=pe)):Re(i.POLYGON_OFFSET_FILL)}function ne(L){L?Ve(i.SCISSOR_TEST):Re(i.SCISSOR_TEST)}function j(L){L===void 0&&(L=i.TEXTURE0+K-1),te!==L&&(i.activeTexture(L),te=L)}function $(L,fe,pe){pe===void 0&&(te===null?pe=i.TEXTURE0+K-1:pe=te);let Be=me[pe];Be===void 0&&(Be={type:void 0,texture:void 0},me[pe]=Be),(Be.type!==L||Be.texture!==fe)&&(te!==pe&&(i.activeTexture(pe),te=pe),i.bindTexture(L,fe||Fe[L]),Be.type=L,Be.texture=fe)}function we(){let L=me[te];L!==void 0&&L.type!==void 0&&(i.bindTexture(L.type,null),L.type=void 0,L.texture=void 0)}function de(){try{i.compressedTexImage2D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function ve(){try{i.compressedTexImage3D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Ne(){try{i.texSubImage2D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Xe(){try{i.texSubImage3D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Q(){try{i.compressedTexSubImage2D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function dt(){try{i.compressedTexSubImage3D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function et(){try{i.texStorage2D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Ge(){try{i.texStorage3D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Ie(){try{i.texImage2D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Se(){try{i.texImage3D.apply(i,arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Ye(L){ge.equals(L)===!1&&(i.scissor(L.x,L.y,L.z,L.w),ge.copy(L))}function mt(L){Ae.equals(L)===!1&&(i.viewport(L.x,L.y,L.z,L.w),Ae.copy(L))}function It(L,fe){let pe=u.get(fe);pe===void 0&&(pe=new WeakMap,u.set(fe,pe));let Be=pe.get(L);Be===void 0&&(Be=i.getUniformBlockIndex(fe,L.name),pe.set(L,Be))}function $e(L,fe){let Be=u.get(fe).get(L);h.get(fe)!==Be&&(i.uniformBlockBinding(fe,Be,L.__bindingPointIndex),h.set(fe,Be))}function le(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),n===!0&&(i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null)),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),d={},te=null,me={},f={},m=new WeakMap,_=[],g=null,p=!1,v=null,x=null,S=null,P=null,T=null,R=null,F=null,M=new Ee(0,0,0),w=0,U=!1,q=null,re=null,I=null,O=null,H=null,ge.set(0,0,i.canvas.width,i.canvas.height),Ae.set(0,0,i.canvas.width,i.canvas.height),a.reset(),c.reset(),l.reset()}return{buffers:{color:a,depth:c,stencil:l},enable:Ve,disable:Re,bindFramebuffer:He,drawBuffers:C,useProgram:ce,setBlending:W,setMaterial:Le,setFlipSided:_e,setCullFace:E,setLineWidth:y,setPolygonOffset:N,setScissorTest:ne,activeTexture:j,bindTexture:$,unbindTexture:we,compressedTexImage2D:de,compressedTexImage3D:ve,texImage2D:Ie,texImage3D:Se,updateUBOMapping:It,uniformBlockBinding:$e,texStorage2D:et,texStorage3D:Ge,texSubImage2D:Ne,texSubImage3D:Xe,compressedTexSubImage2D:Q,compressedTexSubImage3D:dt,scissor:Ye,viewport:mt,reset:le}}function pM(i,e,t,n,s,r,o){let a=s.isWebGL2,c=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),h=new WeakMap,u,d=new WeakMap,f=!1;try{f=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function m(E,y){return f?new OffscreenCanvas(E,y):To("canvas")}function _(E,y,N,ne){let j=1;if((E.width>ne||E.height>ne)&&(j=ne/Math.max(E.width,E.height)),j<1||y===!0)if(typeof HTMLImageElement<"u"&&E instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&E instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&E instanceof ImageBitmap){let $=y?Xa:Math.floor,we=$(j*E.width),de=$(j*E.height);u===void 0&&(u=m(we,de));let ve=N?m(we,de):u;return ve.width=we,ve.height=de,ve.getContext("2d").drawImage(E,0,0,we,de),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+E.width+"x"+E.height+") to ("+we+"x"+de+")."),ve}else return"data"in E&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+E.width+"x"+E.height+")."),E;return E}function g(E){return Jl(E.width)&&Jl(E.height)}function p(E){return a?!1:E.wrapS!==Cn||E.wrapT!==Cn||E.minFilter!==zt&&E.minFilter!==_n}function v(E,y){return E.generateMipmaps&&y&&E.minFilter!==zt&&E.minFilter!==_n}function x(E){i.generateMipmap(E)}function S(E,y,N,ne,j=!1){if(a===!1)return y;if(E!==null){if(i[E]!==void 0)return i[E];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+E+"'")}let $=y;if(y===i.RED&&(N===i.FLOAT&&($=i.R32F),N===i.HALF_FLOAT&&($=i.R16F),N===i.UNSIGNED_BYTE&&($=i.R8)),y===i.RED_INTEGER&&(N===i.UNSIGNED_BYTE&&($=i.R8UI),N===i.UNSIGNED_SHORT&&($=i.R16UI),N===i.UNSIGNED_INT&&($=i.R32UI),N===i.BYTE&&($=i.R8I),N===i.SHORT&&($=i.R16I),N===i.INT&&($=i.R32I)),y===i.RG&&(N===i.FLOAT&&($=i.RG32F),N===i.HALF_FLOAT&&($=i.RG16F),N===i.UNSIGNED_BYTE&&($=i.RG8)),y===i.RGBA){let we=j?Ha:ft.getTransfer(ne);N===i.FLOAT&&($=i.RGBA32F),N===i.HALF_FLOAT&&($=i.RGBA16F),N===i.UNSIGNED_BYTE&&($=we===wt?i.SRGB8_ALPHA8:i.RGBA8),N===i.UNSIGNED_SHORT_4_4_4_4&&($=i.RGBA4),N===i.UNSIGNED_SHORT_5_5_5_1&&($=i.RGB5_A1)}return($===i.R16F||$===i.R32F||$===i.RG16F||$===i.RG32F||$===i.RGBA16F||$===i.RGBA32F)&&e.get("EXT_color_buffer_float"),$}function P(E,y,N){return v(E,N)===!0||E.isFramebufferTexture&&E.minFilter!==zt&&E.minFilter!==_n?Math.log2(Math.max(y.width,y.height))+1:E.mipmaps!==void 0&&E.mipmaps.length>0?E.mipmaps.length:E.isCompressedTexture&&Array.isArray(E.image)?y.mipmaps.length:1}function T(E){return E===zt||E===ka||E===xo?i.NEAREST:i.LINEAR}function R(E){let y=E.target;y.removeEventListener("dispose",R),M(y),y.isVideoTexture&&h.delete(y)}function F(E){let y=E.target;y.removeEventListener("dispose",F),U(y)}function M(E){let y=n.get(E);if(y.__webglInit===void 0)return;let N=E.source,ne=d.get(N);if(ne){let j=ne[y.__cacheKey];j.usedTimes--,j.usedTimes===0&&w(E),Object.keys(ne).length===0&&d.delete(N)}n.remove(E)}function w(E){let y=n.get(E);i.deleteTexture(y.__webglTexture);let N=E.source,ne=d.get(N);delete ne[y.__cacheKey],o.memory.textures--}function U(E){let y=E.texture,N=n.get(E),ne=n.get(y);if(ne.__webglTexture!==void 0&&(i.deleteTexture(ne.__webglTexture),o.memory.textures--),E.depthTexture&&E.depthTexture.dispose(),E.isWebGLCubeRenderTarget)for(let j=0;j<6;j++){if(Array.isArray(N.__webglFramebuffer[j]))for(let $=0;$<N.__webglFramebuffer[j].length;$++)i.deleteFramebuffer(N.__webglFramebuffer[j][$]);else i.deleteFramebuffer(N.__webglFramebuffer[j]);N.__webglDepthbuffer&&i.deleteRenderbuffer(N.__webglDepthbuffer[j])}else{if(Array.isArray(N.__webglFramebuffer))for(let j=0;j<N.__webglFramebuffer.length;j++)i.deleteFramebuffer(N.__webglFramebuffer[j]);else i.deleteFramebuffer(N.__webglFramebuffer);if(N.__webglDepthbuffer&&i.deleteRenderbuffer(N.__webglDepthbuffer),N.__webglMultisampledFramebuffer&&i.deleteFramebuffer(N.__webglMultisampledFramebuffer),N.__webglColorRenderbuffer)for(let j=0;j<N.__webglColorRenderbuffer.length;j++)N.__webglColorRenderbuffer[j]&&i.deleteRenderbuffer(N.__webglColorRenderbuffer[j]);N.__webglDepthRenderbuffer&&i.deleteRenderbuffer(N.__webglDepthRenderbuffer)}if(E.isWebGLMultipleRenderTargets)for(let j=0,$=y.length;j<$;j++){let we=n.get(y[j]);we.__webglTexture&&(i.deleteTexture(we.__webglTexture),o.memory.textures--),n.remove(y[j])}n.remove(y),n.remove(E)}let q=0;function re(){q=0}function I(){let E=q;return E>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+E+" texture units while this GPU supports only "+s.maxTextures),q+=1,E}function O(E){let y=[];return y.push(E.wrapS),y.push(E.wrapT),y.push(E.wrapR||0),y.push(E.magFilter),y.push(E.minFilter),y.push(E.anisotropy),y.push(E.internalFormat),y.push(E.format),y.push(E.type),y.push(E.generateMipmaps),y.push(E.premultiplyAlpha),y.push(E.flipY),y.push(E.unpackAlignment),y.push(E.colorSpace),y.join()}function H(E,y){let N=n.get(E);if(E.isVideoTexture&&Le(E),E.isRenderTargetTexture===!1&&E.version>0&&N.__version!==E.version){let ne=E.image;if(ne===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(ne.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{ge(N,E,y);return}}t.bindTexture(i.TEXTURE_2D,N.__webglTexture,i.TEXTURE0+y)}function K(E,y){let N=n.get(E);if(E.version>0&&N.__version!==E.version){ge(N,E,y);return}t.bindTexture(i.TEXTURE_2D_ARRAY,N.__webglTexture,i.TEXTURE0+y)}function Y(E,y){let N=n.get(E);if(E.version>0&&N.__version!==E.version){ge(N,E,y);return}t.bindTexture(i.TEXTURE_3D,N.__webglTexture,i.TEXTURE0+y)}function V(E,y){let N=n.get(E);if(E.version>0&&N.__version!==E.version){Ae(N,E,y);return}t.bindTexture(i.TEXTURE_CUBE_MAP,N.__webglTexture,i.TEXTURE0+y)}let ee={[Ti]:i.REPEAT,[Cn]:i.CLAMP_TO_EDGE,[bo]:i.MIRRORED_REPEAT},te={[zt]:i.NEAREST,[ka]:i.NEAREST_MIPMAP_NEAREST,[xo]:i.NEAREST_MIPMAP_LINEAR,[_n]:i.LINEAR,[Oh]:i.LINEAR_MIPMAP_NEAREST,[Ki]:i.LINEAR_MIPMAP_LINEAR},me={[o0]:i.NEVER,[d0]:i.ALWAYS,[a0]:i.LESS,[Sp]:i.LEQUAL,[c0]:i.EQUAL,[u0]:i.GEQUAL,[l0]:i.GREATER,[h0]:i.NOTEQUAL};function G(E,y,N){if(N?(i.texParameteri(E,i.TEXTURE_WRAP_S,ee[y.wrapS]),i.texParameteri(E,i.TEXTURE_WRAP_T,ee[y.wrapT]),(E===i.TEXTURE_3D||E===i.TEXTURE_2D_ARRAY)&&i.texParameteri(E,i.TEXTURE_WRAP_R,ee[y.wrapR]),i.texParameteri(E,i.TEXTURE_MAG_FILTER,te[y.magFilter]),i.texParameteri(E,i.TEXTURE_MIN_FILTER,te[y.minFilter])):(i.texParameteri(E,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(E,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),(E===i.TEXTURE_3D||E===i.TEXTURE_2D_ARRAY)&&i.texParameteri(E,i.TEXTURE_WRAP_R,i.CLAMP_TO_EDGE),(y.wrapS!==Cn||y.wrapT!==Cn)&&console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.wrapS and Texture.wrapT should be set to THREE.ClampToEdgeWrapping."),i.texParameteri(E,i.TEXTURE_MAG_FILTER,T(y.magFilter)),i.texParameteri(E,i.TEXTURE_MIN_FILTER,T(y.minFilter)),y.minFilter!==zt&&y.minFilter!==_n&&console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.minFilter should be set to THREE.NearestFilter or THREE.LinearFilter.")),y.compareFunction&&(i.texParameteri(E,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(E,i.TEXTURE_COMPARE_FUNC,me[y.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){let ne=e.get("EXT_texture_filter_anisotropic");if(y.magFilter===zt||y.minFilter!==xo&&y.minFilter!==Ki||y.type===bi&&e.has("OES_texture_float_linear")===!1||a===!1&&y.type===wo&&e.has("OES_texture_half_float_linear")===!1)return;(y.anisotropy>1||n.get(y).__currentAnisotropy)&&(i.texParameterf(E,ne.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(y.anisotropy,s.getMaxAnisotropy())),n.get(y).__currentAnisotropy=y.anisotropy)}}function J(E,y){let N=!1;E.__webglInit===void 0&&(E.__webglInit=!0,y.addEventListener("dispose",R));let ne=y.source,j=d.get(ne);j===void 0&&(j={},d.set(ne,j));let $=O(y);if($!==E.__cacheKey){j[$]===void 0&&(j[$]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,N=!0),j[$].usedTimes++;let we=j[E.__cacheKey];we!==void 0&&(j[E.__cacheKey].usedTimes--,we.usedTimes===0&&w(y)),E.__cacheKey=$,E.__webglTexture=j[$].texture}return N}function ge(E,y,N){let ne=i.TEXTURE_2D;(y.isDataArrayTexture||y.isCompressedArrayTexture)&&(ne=i.TEXTURE_2D_ARRAY),y.isData3DTexture&&(ne=i.TEXTURE_3D);let j=J(E,y),$=y.source;t.bindTexture(ne,E.__webglTexture,i.TEXTURE0+N);let we=n.get($);if($.version!==we.__version||j===!0){t.activeTexture(i.TEXTURE0+N);let de=ft.getPrimaries(ft.workingColorSpace),ve=y.colorSpace===kn?null:ft.getPrimaries(y.colorSpace),Ne=y.colorSpace===kn||de===ve?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,y.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,y.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Ne);let Xe=p(y)&&g(y.image)===!1,Q=_(y.image,Xe,!1,s.maxTextureSize);Q=_e(y,Q);let dt=g(Q)||a,et=r.convert(y.format,y.colorSpace),Ge=r.convert(y.type),Ie=S(y.internalFormat,et,Ge,y.colorSpace,y.isVideoTexture);G(ne,y,dt);let Se,Ye=y.mipmaps,mt=a&&y.isVideoTexture!==!0&&Ie!==xp,It=we.__version===void 0||j===!0,$e=P(y,Q,dt);if(y.isDepthTexture)Ie=i.DEPTH_COMPONENT,a?y.type===bi?Ie=i.DEPTH_COMPONENT32F:y.type===Wi?Ie=i.DEPTH_COMPONENT24:y.type===ws?Ie=i.DEPTH24_STENCIL8:Ie=i.DEPTH_COMPONENT16:y.type===bi&&console.error("WebGLRenderer: Floating point depth texture requires WebGL2."),y.format===Ts&&Ie===i.DEPTH_COMPONENT&&y.type!==Fh&&y.type!==Wi&&(console.warn("THREE.WebGLRenderer: Use UnsignedShortType or UnsignedIntType for DepthFormat DepthTexture."),y.type=Wi,Ge=r.convert(y.type)),y.format===wr&&Ie===i.DEPTH_COMPONENT&&(Ie=i.DEPTH_STENCIL,y.type!==ws&&(console.warn("THREE.WebGLRenderer: Use UnsignedInt248Type for DepthStencilFormat DepthTexture."),y.type=ws,Ge=r.convert(y.type))),It&&(mt?t.texStorage2D(i.TEXTURE_2D,1,Ie,Q.width,Q.height):t.texImage2D(i.TEXTURE_2D,0,Ie,Q.width,Q.height,0,et,Ge,null));else if(y.isDataTexture)if(Ye.length>0&&dt){mt&&It&&t.texStorage2D(i.TEXTURE_2D,$e,Ie,Ye[0].width,Ye[0].height);for(let le=0,L=Ye.length;le<L;le++)Se=Ye[le],mt?t.texSubImage2D(i.TEXTURE_2D,le,0,0,Se.width,Se.height,et,Ge,Se.data):t.texImage2D(i.TEXTURE_2D,le,Ie,Se.width,Se.height,0,et,Ge,Se.data);y.generateMipmaps=!1}else mt?(It&&t.texStorage2D(i.TEXTURE_2D,$e,Ie,Q.width,Q.height),t.texSubImage2D(i.TEXTURE_2D,0,0,0,Q.width,Q.height,et,Ge,Q.data)):t.texImage2D(i.TEXTURE_2D,0,Ie,Q.width,Q.height,0,et,Ge,Q.data);else if(y.isCompressedTexture)if(y.isCompressedArrayTexture){mt&&It&&t.texStorage3D(i.TEXTURE_2D_ARRAY,$e,Ie,Ye[0].width,Ye[0].height,Q.depth);for(let le=0,L=Ye.length;le<L;le++)Se=Ye[le],y.format!==Bn?et!==null?mt?t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,le,0,0,0,Se.width,Se.height,Q.depth,et,Se.data,0,0):t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,le,Ie,Se.width,Se.height,Q.depth,0,Se.data,0,0):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):mt?t.texSubImage3D(i.TEXTURE_2D_ARRAY,le,0,0,0,Se.width,Se.height,Q.depth,et,Ge,Se.data):t.texImage3D(i.TEXTURE_2D_ARRAY,le,Ie,Se.width,Se.height,Q.depth,0,et,Ge,Se.data)}else{mt&&It&&t.texStorage2D(i.TEXTURE_2D,$e,Ie,Ye[0].width,Ye[0].height);for(let le=0,L=Ye.length;le<L;le++)Se=Ye[le],y.format!==Bn?et!==null?mt?t.compressedTexSubImage2D(i.TEXTURE_2D,le,0,0,Se.width,Se.height,et,Se.data):t.compressedTexImage2D(i.TEXTURE_2D,le,Ie,Se.width,Se.height,0,Se.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):mt?t.texSubImage2D(i.TEXTURE_2D,le,0,0,Se.width,Se.height,et,Ge,Se.data):t.texImage2D(i.TEXTURE_2D,le,Ie,Se.width,Se.height,0,et,Ge,Se.data)}else if(y.isDataArrayTexture)mt?(It&&t.texStorage3D(i.TEXTURE_2D_ARRAY,$e,Ie,Q.width,Q.height,Q.depth),t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,Q.width,Q.height,Q.depth,et,Ge,Q.data)):t.texImage3D(i.TEXTURE_2D_ARRAY,0,Ie,Q.width,Q.height,Q.depth,0,et,Ge,Q.data);else if(y.isData3DTexture)mt?(It&&t.texStorage3D(i.TEXTURE_3D,$e,Ie,Q.width,Q.height,Q.depth),t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,Q.width,Q.height,Q.depth,et,Ge,Q.data)):t.texImage3D(i.TEXTURE_3D,0,Ie,Q.width,Q.height,Q.depth,0,et,Ge,Q.data);else if(y.isFramebufferTexture){if(It)if(mt)t.texStorage2D(i.TEXTURE_2D,$e,Ie,Q.width,Q.height);else{let le=Q.width,L=Q.height;for(let fe=0;fe<$e;fe++)t.texImage2D(i.TEXTURE_2D,fe,Ie,le,L,0,et,Ge,null),le>>=1,L>>=1}}else if(Ye.length>0&&dt){mt&&It&&t.texStorage2D(i.TEXTURE_2D,$e,Ie,Ye[0].width,Ye[0].height);for(let le=0,L=Ye.length;le<L;le++)Se=Ye[le],mt?t.texSubImage2D(i.TEXTURE_2D,le,0,0,et,Ge,Se):t.texImage2D(i.TEXTURE_2D,le,Ie,et,Ge,Se);y.generateMipmaps=!1}else mt?(It&&t.texStorage2D(i.TEXTURE_2D,$e,Ie,Q.width,Q.height),t.texSubImage2D(i.TEXTURE_2D,0,0,0,et,Ge,Q)):t.texImage2D(i.TEXTURE_2D,0,Ie,et,Ge,Q);v(y,dt)&&x(ne),we.__version=$.version,y.onUpdate&&y.onUpdate(y)}E.__version=y.version}function Ae(E,y,N){if(y.image.length!==6)return;let ne=J(E,y),j=y.source;t.bindTexture(i.TEXTURE_CUBE_MAP,E.__webglTexture,i.TEXTURE0+N);let $=n.get(j);if(j.version!==$.__version||ne===!0){t.activeTexture(i.TEXTURE0+N);let we=ft.getPrimaries(ft.workingColorSpace),de=y.colorSpace===kn?null:ft.getPrimaries(y.colorSpace),ve=y.colorSpace===kn||we===de?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,y.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,y.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,ve);let Ne=y.isCompressedTexture||y.image[0].isCompressedTexture,Xe=y.image[0]&&y.image[0].isDataTexture,Q=[];for(let le=0;le<6;le++)!Ne&&!Xe?Q[le]=_(y.image[le],!1,!0,s.maxCubemapSize):Q[le]=Xe?y.image[le].image:y.image[le],Q[le]=_e(y,Q[le]);let dt=Q[0],et=g(dt)||a,Ge=r.convert(y.format,y.colorSpace),Ie=r.convert(y.type),Se=S(y.internalFormat,Ge,Ie,y.colorSpace),Ye=a&&y.isVideoTexture!==!0,mt=$.__version===void 0||ne===!0,It=P(y,dt,et);G(i.TEXTURE_CUBE_MAP,y,et);let $e;if(Ne){Ye&&mt&&t.texStorage2D(i.TEXTURE_CUBE_MAP,It,Se,dt.width,dt.height);for(let le=0;le<6;le++){$e=Q[le].mipmaps;for(let L=0;L<$e.length;L++){let fe=$e[L];y.format!==Bn?Ge!==null?Ye?t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,L,0,0,fe.width,fe.height,Ge,fe.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,L,Se,fe.width,fe.height,0,fe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Ye?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,L,0,0,fe.width,fe.height,Ge,Ie,fe.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,L,Se,fe.width,fe.height,0,Ge,Ie,fe.data)}}}else{$e=y.mipmaps,Ye&&mt&&($e.length>0&&It++,t.texStorage2D(i.TEXTURE_CUBE_MAP,It,Se,Q[0].width,Q[0].height));for(let le=0;le<6;le++)if(Xe){Ye?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,0,0,0,Q[le].width,Q[le].height,Ge,Ie,Q[le].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,0,Se,Q[le].width,Q[le].height,0,Ge,Ie,Q[le].data);for(let L=0;L<$e.length;L++){let pe=$e[L].image[le].image;Ye?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,L+1,0,0,pe.width,pe.height,Ge,Ie,pe.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,L+1,Se,pe.width,pe.height,0,Ge,Ie,pe.data)}}else{Ye?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,0,0,0,Ge,Ie,Q[le]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,0,Se,Ge,Ie,Q[le]);for(let L=0;L<$e.length;L++){let fe=$e[L];Ye?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,L+1,0,0,Ge,Ie,fe.image[le]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+le,L+1,Se,Ge,Ie,fe.image[le])}}}v(y,et)&&x(i.TEXTURE_CUBE_MAP),$.__version=j.version,y.onUpdate&&y.onUpdate(y)}E.__version=y.version}function ye(E,y,N,ne,j,$){let we=r.convert(N.format,N.colorSpace),de=r.convert(N.type),ve=S(N.internalFormat,we,de,N.colorSpace);if(!n.get(y).__hasExternalTextures){let Xe=Math.max(1,y.width>>$),Q=Math.max(1,y.height>>$);j===i.TEXTURE_3D||j===i.TEXTURE_2D_ARRAY?t.texImage3D(j,$,ve,Xe,Q,y.depth,0,we,de,null):t.texImage2D(j,$,ve,Xe,Q,0,we,de,null)}t.bindFramebuffer(i.FRAMEBUFFER,E),W(y)?c.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,ne,j,n.get(N).__webglTexture,0,oe(y)):(j===i.TEXTURE_2D||j>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&j<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,ne,j,n.get(N).__webglTexture,$),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Fe(E,y,N){if(i.bindRenderbuffer(i.RENDERBUFFER,E),y.depthBuffer&&!y.stencilBuffer){let ne=a===!0?i.DEPTH_COMPONENT24:i.DEPTH_COMPONENT16;if(N||W(y)){let j=y.depthTexture;j&&j.isDepthTexture&&(j.type===bi?ne=i.DEPTH_COMPONENT32F:j.type===Wi&&(ne=i.DEPTH_COMPONENT24));let $=oe(y);W(y)?c.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,$,ne,y.width,y.height):i.renderbufferStorageMultisample(i.RENDERBUFFER,$,ne,y.width,y.height)}else i.renderbufferStorage(i.RENDERBUFFER,ne,y.width,y.height);i.framebufferRenderbuffer(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.RENDERBUFFER,E)}else if(y.depthBuffer&&y.stencilBuffer){let ne=oe(y);N&&W(y)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,ne,i.DEPTH24_STENCIL8,y.width,y.height):W(y)?c.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,ne,i.DEPTH24_STENCIL8,y.width,y.height):i.renderbufferStorage(i.RENDERBUFFER,i.DEPTH_STENCIL,y.width,y.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.RENDERBUFFER,E)}else{let ne=y.isWebGLMultipleRenderTargets===!0?y.texture:[y.texture];for(let j=0;j<ne.length;j++){let $=ne[j],we=r.convert($.format,$.colorSpace),de=r.convert($.type),ve=S($.internalFormat,we,de,$.colorSpace),Ne=oe(y);N&&W(y)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,Ne,ve,y.width,y.height):W(y)?c.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Ne,ve,y.width,y.height):i.renderbufferStorage(i.RENDERBUFFER,ve,y.width,y.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Ve(E,y){if(y&&y.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,E),!(y.depthTexture&&y.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");(!n.get(y.depthTexture).__webglTexture||y.depthTexture.image.width!==y.width||y.depthTexture.image.height!==y.height)&&(y.depthTexture.image.width=y.width,y.depthTexture.image.height=y.height,y.depthTexture.needsUpdate=!0),H(y.depthTexture,0);let ne=n.get(y.depthTexture).__webglTexture,j=oe(y);if(y.depthTexture.format===Ts)W(y)?c.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,ne,0,j):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,ne,0);else if(y.depthTexture.format===wr)W(y)?c.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,ne,0,j):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,ne,0);else throw new Error("Unknown depthTexture format")}function Re(E){let y=n.get(E),N=E.isWebGLCubeRenderTarget===!0;if(E.depthTexture&&!y.__autoAllocateDepthBuffer){if(N)throw new Error("target.depthTexture not supported in Cube render targets");Ve(y.__webglFramebuffer,E)}else if(N){y.__webglDepthbuffer=[];for(let ne=0;ne<6;ne++)t.bindFramebuffer(i.FRAMEBUFFER,y.__webglFramebuffer[ne]),y.__webglDepthbuffer[ne]=i.createRenderbuffer(),Fe(y.__webglDepthbuffer[ne],E,!1)}else t.bindFramebuffer(i.FRAMEBUFFER,y.__webglFramebuffer),y.__webglDepthbuffer=i.createRenderbuffer(),Fe(y.__webglDepthbuffer,E,!1);t.bindFramebuffer(i.FRAMEBUFFER,null)}function He(E,y,N){let ne=n.get(E);y!==void 0&&ye(ne.__webglFramebuffer,E,E.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),N!==void 0&&Re(E)}function C(E){let y=E.texture,N=n.get(E),ne=n.get(y);E.addEventListener("dispose",F),E.isWebGLMultipleRenderTargets!==!0&&(ne.__webglTexture===void 0&&(ne.__webglTexture=i.createTexture()),ne.__version=y.version,o.memory.textures++);let j=E.isWebGLCubeRenderTarget===!0,$=E.isWebGLMultipleRenderTargets===!0,we=g(E)||a;if(j){N.__webglFramebuffer=[];for(let de=0;de<6;de++)if(a&&y.mipmaps&&y.mipmaps.length>0){N.__webglFramebuffer[de]=[];for(let ve=0;ve<y.mipmaps.length;ve++)N.__webglFramebuffer[de][ve]=i.createFramebuffer()}else N.__webglFramebuffer[de]=i.createFramebuffer()}else{if(a&&y.mipmaps&&y.mipmaps.length>0){N.__webglFramebuffer=[];for(let de=0;de<y.mipmaps.length;de++)N.__webglFramebuffer[de]=i.createFramebuffer()}else N.__webglFramebuffer=i.createFramebuffer();if($)if(s.drawBuffers){let de=E.texture;for(let ve=0,Ne=de.length;ve<Ne;ve++){let Xe=n.get(de[ve]);Xe.__webglTexture===void 0&&(Xe.__webglTexture=i.createTexture(),o.memory.textures++)}}else console.warn("THREE.WebGLRenderer: WebGLMultipleRenderTargets can only be used with WebGL2 or WEBGL_draw_buffers extension.");if(a&&E.samples>0&&W(E)===!1){let de=$?y:[y];N.__webglMultisampledFramebuffer=i.createFramebuffer(),N.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,N.__webglMultisampledFramebuffer);for(let ve=0;ve<de.length;ve++){let Ne=de[ve];N.__webglColorRenderbuffer[ve]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,N.__webglColorRenderbuffer[ve]);let Xe=r.convert(Ne.format,Ne.colorSpace),Q=r.convert(Ne.type),dt=S(Ne.internalFormat,Xe,Q,Ne.colorSpace,E.isXRRenderTarget===!0),et=oe(E);i.renderbufferStorageMultisample(i.RENDERBUFFER,et,dt,E.width,E.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ve,i.RENDERBUFFER,N.__webglColorRenderbuffer[ve])}i.bindRenderbuffer(i.RENDERBUFFER,null),E.depthBuffer&&(N.__webglDepthRenderbuffer=i.createRenderbuffer(),Fe(N.__webglDepthRenderbuffer,E,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(j){t.bindTexture(i.TEXTURE_CUBE_MAP,ne.__webglTexture),G(i.TEXTURE_CUBE_MAP,y,we);for(let de=0;de<6;de++)if(a&&y.mipmaps&&y.mipmaps.length>0)for(let ve=0;ve<y.mipmaps.length;ve++)ye(N.__webglFramebuffer[de][ve],E,y,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+de,ve);else ye(N.__webglFramebuffer[de],E,y,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+de,0);v(y,we)&&x(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if($){let de=E.texture;for(let ve=0,Ne=de.length;ve<Ne;ve++){let Xe=de[ve],Q=n.get(Xe);t.bindTexture(i.TEXTURE_2D,Q.__webglTexture),G(i.TEXTURE_2D,Xe,we),ye(N.__webglFramebuffer,E,Xe,i.COLOR_ATTACHMENT0+ve,i.TEXTURE_2D,0),v(Xe,we)&&x(i.TEXTURE_2D)}t.unbindTexture()}else{let de=i.TEXTURE_2D;if((E.isWebGL3DRenderTarget||E.isWebGLArrayRenderTarget)&&(a?de=E.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY:console.error("THREE.WebGLTextures: THREE.Data3DTexture and THREE.DataArrayTexture only supported with WebGL2.")),t.bindTexture(de,ne.__webglTexture),G(de,y,we),a&&y.mipmaps&&y.mipmaps.length>0)for(let ve=0;ve<y.mipmaps.length;ve++)ye(N.__webglFramebuffer[ve],E,y,i.COLOR_ATTACHMENT0,de,ve);else ye(N.__webglFramebuffer,E,y,i.COLOR_ATTACHMENT0,de,0);v(y,we)&&x(de),t.unbindTexture()}E.depthBuffer&&Re(E)}function ce(E){let y=g(E)||a,N=E.isWebGLMultipleRenderTargets===!0?E.texture:[E.texture];for(let ne=0,j=N.length;ne<j;ne++){let $=N[ne];if(v($,y)){let we=E.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:i.TEXTURE_2D,de=n.get($).__webglTexture;t.bindTexture(we,de),x(we),t.unbindTexture()}}}function X(E){if(a&&E.samples>0&&W(E)===!1){let y=E.isWebGLMultipleRenderTargets?E.texture:[E.texture],N=E.width,ne=E.height,j=i.COLOR_BUFFER_BIT,$=[],we=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,de=n.get(E),ve=E.isWebGLMultipleRenderTargets===!0;if(ve)for(let Ne=0;Ne<y.length;Ne++)t.bindFramebuffer(i.FRAMEBUFFER,de.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ne,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,de.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ne,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,de.__webglMultisampledFramebuffer),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,de.__webglFramebuffer);for(let Ne=0;Ne<y.length;Ne++){$.push(i.COLOR_ATTACHMENT0+Ne),E.depthBuffer&&$.push(we);let Xe=de.__ignoreDepthValues!==void 0?de.__ignoreDepthValues:!1;if(Xe===!1&&(E.depthBuffer&&(j|=i.DEPTH_BUFFER_BIT),E.stencilBuffer&&(j|=i.STENCIL_BUFFER_BIT)),ve&&i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,de.__webglColorRenderbuffer[Ne]),Xe===!0&&(i.invalidateFramebuffer(i.READ_FRAMEBUFFER,[we]),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[we])),ve){let Q=n.get(y[Ne]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,Q,0)}i.blitFramebuffer(0,0,N,ne,0,0,N,ne,j,i.NEAREST),l&&i.invalidateFramebuffer(i.READ_FRAMEBUFFER,$)}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),ve)for(let Ne=0;Ne<y.length;Ne++){t.bindFramebuffer(i.FRAMEBUFFER,de.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ne,i.RENDERBUFFER,de.__webglColorRenderbuffer[Ne]);let Xe=n.get(y[Ne]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,de.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ne,i.TEXTURE_2D,Xe,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,de.__webglMultisampledFramebuffer)}}function oe(E){return Math.min(s.maxSamples,E.samples)}function W(E){let y=n.get(E);return a&&E.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&y.__useRenderToTexture!==!1}function Le(E){let y=o.render.frame;h.get(E)!==y&&(h.set(E,y),E.update())}function _e(E,y){let N=E.colorSpace,ne=E.format,j=E.type;return E.isCompressedTexture===!0||E.isVideoTexture===!0||E.format===$l||N!==Ht&&N!==kn&&(ft.getTransfer(N)===wt?a===!1?e.has("EXT_sRGB")===!0&&ne===Bn?(E.format=$l,E.minFilter=_n,E.generateMipmaps=!1):y=qa.sRGBToLinear(y):(ne!==Bn||j!==Yi)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",N)),y}this.allocateTextureUnit=I,this.resetTextureUnits=re,this.setTexture2D=H,this.setTexture2DArray=K,this.setTexture3D=Y,this.setTextureCube=V,this.rebindTextures=He,this.setupRenderTarget=C,this.updateRenderTargetMipmap=ce,this.updateMultisampleRenderTarget=X,this.setupDepthRenderbuffer=Re,this.setupFrameBufferTexture=ye,this.useMultisampledRTT=W}function mM(i,e,t){let n=t.isWebGL2;function s(r,o=kn){let a,c=ft.getTransfer(o);if(r===Yi)return i.UNSIGNED_BYTE;if(r===fp)return i.UNSIGNED_SHORT_4_4_4_4;if(r===pp)return i.UNSIGNED_SHORT_5_5_5_1;if(r===qg)return i.BYTE;if(r===Yg)return i.SHORT;if(r===Fh)return i.UNSIGNED_SHORT;if(r===dp)return i.INT;if(r===Wi)return i.UNSIGNED_INT;if(r===bi)return i.FLOAT;if(r===wo)return n?i.HALF_FLOAT:(a=e.get("OES_texture_half_float"),a!==null?a.HALF_FLOAT_OES:null);if(r===Zg)return i.ALPHA;if(r===Bn)return i.RGBA;if(r===Kg)return i.LUMINANCE;if(r===$g)return i.LUMINANCE_ALPHA;if(r===Ts)return i.DEPTH_COMPONENT;if(r===wr)return i.DEPTH_STENCIL;if(r===$l)return a=e.get("EXT_sRGB"),a!==null?a.SRGB_ALPHA_EXT:null;if(r===Jg)return i.RED;if(r===mp)return i.RED_INTEGER;if(r===jg)return i.RG;if(r===gp)return i.RG_INTEGER;if(r===_p)return i.RGBA_INTEGER;if(r===cl||r===ll||r===hl||r===ul)if(c===wt)if(a=e.get("WEBGL_compressed_texture_s3tc_srgb"),a!==null){if(r===cl)return a.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(r===ll)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(r===hl)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(r===ul)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(a=e.get("WEBGL_compressed_texture_s3tc"),a!==null){if(r===cl)return a.COMPRESSED_RGB_S3TC_DXT1_EXT;if(r===ll)return a.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(r===hl)return a.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(r===ul)return a.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(r===Td||r===Ad||r===Rd||r===Cd)if(a=e.get("WEBGL_compressed_texture_pvrtc"),a!==null){if(r===Td)return a.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(r===Ad)return a.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(r===Rd)return a.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(r===Cd)return a.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(r===xp)return a=e.get("WEBGL_compressed_texture_etc1"),a!==null?a.COMPRESSED_RGB_ETC1_WEBGL:null;if(r===Pd||r===Ld)if(a=e.get("WEBGL_compressed_texture_etc"),a!==null){if(r===Pd)return c===wt?a.COMPRESSED_SRGB8_ETC2:a.COMPRESSED_RGB8_ETC2;if(r===Ld)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:a.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(r===Id||r===Dd||r===Nd||r===Ud||r===Od||r===Fd||r===Bd||r===kd||r===zd||r===Hd||r===Gd||r===Vd||r===Wd||r===Xd)if(a=e.get("WEBGL_compressed_texture_astc"),a!==null){if(r===Id)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:a.COMPRESSED_RGBA_ASTC_4x4_KHR;if(r===Dd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:a.COMPRESSED_RGBA_ASTC_5x4_KHR;if(r===Nd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:a.COMPRESSED_RGBA_ASTC_5x5_KHR;if(r===Ud)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:a.COMPRESSED_RGBA_ASTC_6x5_KHR;if(r===Od)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:a.COMPRESSED_RGBA_ASTC_6x6_KHR;if(r===Fd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:a.COMPRESSED_RGBA_ASTC_8x5_KHR;if(r===Bd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:a.COMPRESSED_RGBA_ASTC_8x6_KHR;if(r===kd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:a.COMPRESSED_RGBA_ASTC_8x8_KHR;if(r===zd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:a.COMPRESSED_RGBA_ASTC_10x5_KHR;if(r===Hd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:a.COMPRESSED_RGBA_ASTC_10x6_KHR;if(r===Gd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:a.COMPRESSED_RGBA_ASTC_10x8_KHR;if(r===Vd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:a.COMPRESSED_RGBA_ASTC_10x10_KHR;if(r===Wd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:a.COMPRESSED_RGBA_ASTC_12x10_KHR;if(r===Xd)return c===wt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:a.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(r===dl||r===qd||r===Yd)if(a=e.get("EXT_texture_compression_bptc"),a!==null){if(r===dl)return c===wt?a.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:a.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(r===qd)return a.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(r===Yd)return a.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(r===Qg||r===Zd||r===Kd||r===$d)if(a=e.get("EXT_texture_compression_rgtc"),a!==null){if(r===dl)return a.COMPRESSED_RED_RGTC1_EXT;if(r===Zd)return a.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(r===Kd)return a.COMPRESSED_RED_GREEN_RGTC2_EXT;if(r===$d)return a.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return r===ws?n?i.UNSIGNED_INT_24_8:(a=e.get("WEBGL_depth_texture"),a!==null?a.UNSIGNED_INT_24_8_WEBGL:null):i[r]!==void 0?i[r]:null}return{convert:s}}var hh=class extends en{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}},it=class extends Tt{constructor(){super(),this.isGroup=!0,this.type="Group"}},gM={type:"move"},Mo=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new it,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new it,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new A,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new A),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new it,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new A,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new A),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,o=null,a=this._targetRay,c=this._grip,l=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(l&&e.hand){o=!0;for(let _ of e.hand.values()){let g=t.getJointPose(_,n),p=this._getHandJoint(l,_);g!==null&&(p.matrix.fromArray(g.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=g.radius),p.visible=g!==null}let h=l.joints["index-finger-tip"],u=l.joints["thumb-tip"],d=h.position.distanceTo(u.position),f=.02,m=.005;l.inputState.pinching&&d>f+m?(l.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!l.inputState.pinching&&d<=f-m&&(l.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else c!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(c.matrix.fromArray(r.transform.matrix),c.matrix.decompose(c.position,c.rotation,c.scale),c.matrixWorldNeedsUpdate=!0,r.linearVelocity?(c.hasLinearVelocity=!0,c.linearVelocity.copy(r.linearVelocity)):c.hasLinearVelocity=!1,r.angularVelocity?(c.hasAngularVelocity=!0,c.angularVelocity.copy(r.angularVelocity)):c.hasAngularVelocity=!1));a!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(gM)))}return a!==null&&(a.visible=s!==null),c!==null&&(c.visible=r!==null),l!==null&&(l.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new it;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},uh=class extends Ai{constructor(e,t){super();let n=this,s=null,r=1,o=null,a="local-floor",c=1,l=null,h=null,u=null,d=null,f=null,m=null,_=t.getContextAttributes(),g=null,p=null,v=[],x=[],S=new se,P=null,T=new en;T.layers.enable(1),T.viewport=new yt;let R=new en;R.layers.enable(2),R.viewport=new yt;let F=[T,R],M=new hh;M.layers.enable(1),M.layers.enable(2);let w=null,U=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(G){let J=v[G];return J===void 0&&(J=new Mo,v[G]=J),J.getTargetRaySpace()},this.getControllerGrip=function(G){let J=v[G];return J===void 0&&(J=new Mo,v[G]=J),J.getGripSpace()},this.getHand=function(G){let J=v[G];return J===void 0&&(J=new Mo,v[G]=J),J.getHandSpace()};function q(G){let J=x.indexOf(G.inputSource);if(J===-1)return;let ge=v[J];ge!==void 0&&(ge.update(G.inputSource,G.frame,l||o),ge.dispatchEvent({type:G.type,data:G.inputSource}))}function re(){s.removeEventListener("select",q),s.removeEventListener("selectstart",q),s.removeEventListener("selectend",q),s.removeEventListener("squeeze",q),s.removeEventListener("squeezestart",q),s.removeEventListener("squeezeend",q),s.removeEventListener("end",re),s.removeEventListener("inputsourceschange",I);for(let G=0;G<v.length;G++){let J=x[G];J!==null&&(x[G]=null,v[G].disconnect(J))}w=null,U=null,e.setRenderTarget(g),f=null,d=null,u=null,s=null,p=null,me.stop(),n.isPresenting=!1,e.setPixelRatio(P),e.setSize(S.width,S.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(G){r=G,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(G){a=G,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return l||o},this.setReferenceSpace=function(G){l=G},this.getBaseLayer=function(){return d!==null?d:f},this.getBinding=function(){return u},this.getFrame=function(){return m},this.getSession=function(){return s},this.setSession=async function(G){if(s=G,s!==null){if(g=e.getRenderTarget(),s.addEventListener("select",q),s.addEventListener("selectstart",q),s.addEventListener("selectend",q),s.addEventListener("squeeze",q),s.addEventListener("squeezestart",q),s.addEventListener("squeezeend",q),s.addEventListener("end",re),s.addEventListener("inputsourceschange",I),_.xrCompatible!==!0&&await t.makeXRCompatible(),P=e.getPixelRatio(),e.getSize(S),s.renderState.layers===void 0||e.capabilities.isWebGL2===!1){let J={antialias:s.renderState.layers===void 0?_.antialias:!0,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:r};f=new XRWebGLLayer(s,t,J),s.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),p=new Ri(f.framebufferWidth,f.framebufferHeight,{format:Bn,type:Yi,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil})}else{let J=null,ge=null,Ae=null;_.depth&&(Ae=_.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,J=_.stencil?wr:Ts,ge=_.stencil?ws:Wi);let ye={colorFormat:t.RGBA8,depthFormat:Ae,scaleFactor:r};u=new XRWebGLBinding(s,t),d=u.createProjectionLayer(ye),s.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),p=new Ri(d.textureWidth,d.textureHeight,{format:Bn,type:Yi,depthTexture:new ec(d.textureWidth,d.textureHeight,ge,void 0,void 0,void 0,void 0,void 0,void 0,J),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0});let Fe=e.properties.get(p);Fe.__ignoreDepthValues=d.ignoreDepthValues}p.isXRRenderTarget=!0,this.setFoveation(c),l=null,o=await s.requestReferenceSpace(a),me.setContext(s),me.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode};function I(G){for(let J=0;J<G.removed.length;J++){let ge=G.removed[J],Ae=x.indexOf(ge);Ae>=0&&(x[Ae]=null,v[Ae].disconnect(ge))}for(let J=0;J<G.added.length;J++){let ge=G.added[J],Ae=x.indexOf(ge);if(Ae===-1){for(let Fe=0;Fe<v.length;Fe++)if(Fe>=x.length){x.push(ge),Ae=Fe;break}else if(x[Fe]===null){x[Fe]=ge,Ae=Fe;break}if(Ae===-1)break}let ye=v[Ae];ye&&ye.connect(ge)}}let O=new A,H=new A;function K(G,J,ge){O.setFromMatrixPosition(J.matrixWorld),H.setFromMatrixPosition(ge.matrixWorld);let Ae=O.distanceTo(H),ye=J.projectionMatrix.elements,Fe=ge.projectionMatrix.elements,Ve=ye[14]/(ye[10]-1),Re=ye[14]/(ye[10]+1),He=(ye[9]+1)/ye[5],C=(ye[9]-1)/ye[5],ce=(ye[8]-1)/ye[0],X=(Fe[8]+1)/Fe[0],oe=Ve*ce,W=Ve*X,Le=Ae/(-ce+X),_e=Le*-ce;J.matrixWorld.decompose(G.position,G.quaternion,G.scale),G.translateX(_e),G.translateZ(Le),G.matrixWorld.compose(G.position,G.quaternion,G.scale),G.matrixWorldInverse.copy(G.matrixWorld).invert();let E=Ve+Le,y=Re+Le,N=oe-_e,ne=W+(Ae-_e),j=He*Re/y*E,$=C*Re/y*E;G.projectionMatrix.makePerspective(N,ne,j,$,E,y),G.projectionMatrixInverse.copy(G.projectionMatrix).invert()}function Y(G,J){J===null?G.matrixWorld.copy(G.matrix):G.matrixWorld.multiplyMatrices(J.matrixWorld,G.matrix),G.matrixWorldInverse.copy(G.matrixWorld).invert()}this.updateCamera=function(G){if(s===null)return;M.near=R.near=T.near=G.near,M.far=R.far=T.far=G.far,(w!==M.near||U!==M.far)&&(s.updateRenderState({depthNear:M.near,depthFar:M.far}),w=M.near,U=M.far);let J=G.parent,ge=M.cameras;Y(M,J);for(let Ae=0;Ae<ge.length;Ae++)Y(ge[Ae],J);ge.length===2?K(M,T,R):M.projectionMatrix.copy(T.projectionMatrix),V(G,M,J)};function V(G,J,ge){ge===null?G.matrix.copy(J.matrixWorld):(G.matrix.copy(ge.matrixWorld),G.matrix.invert(),G.matrix.multiply(J.matrixWorld)),G.matrix.decompose(G.position,G.quaternion,G.scale),G.updateMatrixWorld(!0),G.projectionMatrix.copy(J.projectionMatrix),G.projectionMatrixInverse.copy(J.projectionMatrixInverse),G.isPerspectiveCamera&&(G.fov=Ar*2*Math.atan(1/G.projectionMatrix.elements[5]),G.zoom=1)}this.getCamera=function(){return M},this.getFoveation=function(){if(!(d===null&&f===null))return c},this.setFoveation=function(G){c=G,d!==null&&(d.fixedFoveation=G),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=G)};let ee=null;function te(G,J){if(h=J.getViewerPose(l||o),m=J,h!==null){let ge=h.views;f!==null&&(e.setRenderTargetFramebuffer(p,f.framebuffer),e.setRenderTarget(p));let Ae=!1;ge.length!==M.cameras.length&&(M.cameras.length=0,Ae=!0);for(let ye=0;ye<ge.length;ye++){let Fe=ge[ye],Ve=null;if(f!==null)Ve=f.getViewport(Fe);else{let He=u.getViewSubImage(d,Fe);Ve=He.viewport,ye===0&&(e.setRenderTargetTextures(p,He.colorTexture,d.ignoreDepthValues?void 0:He.depthStencilTexture),e.setRenderTarget(p))}let Re=F[ye];Re===void 0&&(Re=new en,Re.layers.enable(ye),Re.viewport=new yt,F[ye]=Re),Re.matrix.fromArray(Fe.transform.matrix),Re.matrix.decompose(Re.position,Re.quaternion,Re.scale),Re.projectionMatrix.fromArray(Fe.projectionMatrix),Re.projectionMatrixInverse.copy(Re.projectionMatrix).invert(),Re.viewport.set(Ve.x,Ve.y,Ve.width,Ve.height),ye===0&&(M.matrix.copy(Re.matrix),M.matrix.decompose(M.position,M.quaternion,M.scale)),Ae===!0&&M.cameras.push(Re)}}for(let ge=0;ge<v.length;ge++){let Ae=x[ge],ye=v[ge];Ae!==null&&ye!==void 0&&ye.update(Ae,J,l||o)}ee&&ee(G,J),J.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:J}),m=null}let me=new Tp;me.setAnimationLoop(te),this.setAnimationLoop=function(G){ee=G},this.dispose=function(){}}};function _M(i,e){function t(g,p){g.matrixAutoUpdate===!0&&g.updateMatrix(),p.value.copy(g.matrix)}function n(g,p){p.color.getRGB(g.fogColor.value,wp(i)),p.isFog?(g.fogNear.value=p.near,g.fogFar.value=p.far):p.isFogExp2&&(g.fogDensity.value=p.density)}function s(g,p,v,x,S){p.isMeshBasicMaterial||p.isMeshLambertMaterial?r(g,p):p.isMeshToonMaterial?(r(g,p),u(g,p)):p.isMeshPhongMaterial?(r(g,p),h(g,p)):p.isMeshStandardMaterial?(r(g,p),d(g,p),p.isMeshPhysicalMaterial&&f(g,p,S)):p.isMeshMatcapMaterial?(r(g,p),m(g,p)):p.isMeshDepthMaterial?r(g,p):p.isMeshDistanceMaterial?(r(g,p),_(g,p)):p.isMeshNormalMaterial?r(g,p):p.isLineBasicMaterial?(o(g,p),p.isLineDashedMaterial&&a(g,p)):p.isPointsMaterial?c(g,p,v,x):p.isSpriteMaterial?l(g,p):p.isShadowMaterial?(g.color.value.copy(p.color),g.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function r(g,p){g.opacity.value=p.opacity,p.color&&g.diffuse.value.copy(p.color),p.emissive&&g.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(g.map.value=p.map,t(p.map,g.mapTransform)),p.alphaMap&&(g.alphaMap.value=p.alphaMap,t(p.alphaMap,g.alphaMapTransform)),p.bumpMap&&(g.bumpMap.value=p.bumpMap,t(p.bumpMap,g.bumpMapTransform),g.bumpScale.value=p.bumpScale,p.side===Mn&&(g.bumpScale.value*=-1)),p.normalMap&&(g.normalMap.value=p.normalMap,t(p.normalMap,g.normalMapTransform),g.normalScale.value.copy(p.normalScale),p.side===Mn&&g.normalScale.value.negate()),p.displacementMap&&(g.displacementMap.value=p.displacementMap,t(p.displacementMap,g.displacementMapTransform),g.displacementScale.value=p.displacementScale,g.displacementBias.value=p.displacementBias),p.emissiveMap&&(g.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,g.emissiveMapTransform)),p.specularMap&&(g.specularMap.value=p.specularMap,t(p.specularMap,g.specularMapTransform)),p.alphaTest>0&&(g.alphaTest.value=p.alphaTest);let v=e.get(p).envMap;if(v&&(g.envMap.value=v,g.flipEnvMap.value=v.isCubeTexture&&v.isRenderTargetTexture===!1?-1:1,g.reflectivity.value=p.reflectivity,g.ior.value=p.ior,g.refractionRatio.value=p.refractionRatio),p.lightMap){g.lightMap.value=p.lightMap;let x=i._useLegacyLights===!0?Math.PI:1;g.lightMapIntensity.value=p.lightMapIntensity*x,t(p.lightMap,g.lightMapTransform)}p.aoMap&&(g.aoMap.value=p.aoMap,g.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,g.aoMapTransform))}function o(g,p){g.diffuse.value.copy(p.color),g.opacity.value=p.opacity,p.map&&(g.map.value=p.map,t(p.map,g.mapTransform))}function a(g,p){g.dashSize.value=p.dashSize,g.totalSize.value=p.dashSize+p.gapSize,g.scale.value=p.scale}function c(g,p,v,x){g.diffuse.value.copy(p.color),g.opacity.value=p.opacity,g.size.value=p.size*v,g.scale.value=x*.5,p.map&&(g.map.value=p.map,t(p.map,g.uvTransform)),p.alphaMap&&(g.alphaMap.value=p.alphaMap,t(p.alphaMap,g.alphaMapTransform)),p.alphaTest>0&&(g.alphaTest.value=p.alphaTest)}function l(g,p){g.diffuse.value.copy(p.color),g.opacity.value=p.opacity,g.rotation.value=p.rotation,p.map&&(g.map.value=p.map,t(p.map,g.mapTransform)),p.alphaMap&&(g.alphaMap.value=p.alphaMap,t(p.alphaMap,g.alphaMapTransform)),p.alphaTest>0&&(g.alphaTest.value=p.alphaTest)}function h(g,p){g.specular.value.copy(p.specular),g.shininess.value=Math.max(p.shininess,1e-4)}function u(g,p){p.gradientMap&&(g.gradientMap.value=p.gradientMap)}function d(g,p){g.metalness.value=p.metalness,p.metalnessMap&&(g.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,g.metalnessMapTransform)),g.roughness.value=p.roughness,p.roughnessMap&&(g.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,g.roughnessMapTransform)),e.get(p).envMap&&(g.envMapIntensity.value=p.envMapIntensity)}function f(g,p,v){g.ior.value=p.ior,p.sheen>0&&(g.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),g.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(g.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,g.sheenColorMapTransform)),p.sheenRoughnessMap&&(g.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,g.sheenRoughnessMapTransform))),p.clearcoat>0&&(g.clearcoat.value=p.clearcoat,g.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(g.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,g.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(g.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Mn&&g.clearcoatNormalScale.value.negate())),p.iridescence>0&&(g.iridescence.value=p.iridescence,g.iridescenceIOR.value=p.iridescenceIOR,g.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],g.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(g.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,g.iridescenceMapTransform)),p.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),p.transmission>0&&(g.transmission.value=p.transmission,g.transmissionSamplerMap.value=v.texture,g.transmissionSamplerSize.value.set(v.width,v.height),p.transmissionMap&&(g.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,g.transmissionMapTransform)),g.thickness.value=p.thickness,p.thicknessMap&&(g.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=p.attenuationDistance,g.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(g.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(g.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=p.specularIntensity,g.specularColor.value.copy(p.specularColor),p.specularColorMap&&(g.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,g.specularColorMapTransform)),p.specularIntensityMap&&(g.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,g.specularIntensityMapTransform))}function m(g,p){p.matcap&&(g.matcap.value=p.matcap)}function _(g,p){let v=e.get(p).light;g.referencePosition.value.setFromMatrixPosition(v.matrixWorld),g.nearDistance.value=v.shadow.camera.near,g.farDistance.value=v.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function xM(i,e,t,n){let s={},r={},o=[],a=t.isWebGL2?i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS):0;function c(v,x){let S=x.program;n.uniformBlockBinding(v,S)}function l(v,x){let S=s[v.id];S===void 0&&(m(v),S=h(v),s[v.id]=S,v.addEventListener("dispose",g));let P=x.program;n.updateUBOMapping(v,P);let T=e.render.frame;r[v.id]!==T&&(d(v),r[v.id]=T)}function h(v){let x=u();v.__bindingPointIndex=x;let S=i.createBuffer(),P=v.__size,T=v.usage;return i.bindBuffer(i.UNIFORM_BUFFER,S),i.bufferData(i.UNIFORM_BUFFER,P,T),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,x,S),S}function u(){for(let v=0;v<a;v++)if(o.indexOf(v)===-1)return o.push(v),v;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(v){let x=s[v.id],S=v.uniforms,P=v.__cache;i.bindBuffer(i.UNIFORM_BUFFER,x);for(let T=0,R=S.length;T<R;T++){let F=Array.isArray(S[T])?S[T]:[S[T]];for(let M=0,w=F.length;M<w;M++){let U=F[M];if(f(U,T,M,P)===!0){let q=U.__offset,re=Array.isArray(U.value)?U.value:[U.value],I=0;for(let O=0;O<re.length;O++){let H=re[O],K=_(H);typeof H=="number"||typeof H=="boolean"?(U.__data[0]=H,i.bufferSubData(i.UNIFORM_BUFFER,q+I,U.__data)):H.isMatrix3?(U.__data[0]=H.elements[0],U.__data[1]=H.elements[1],U.__data[2]=H.elements[2],U.__data[3]=0,U.__data[4]=H.elements[3],U.__data[5]=H.elements[4],U.__data[6]=H.elements[5],U.__data[7]=0,U.__data[8]=H.elements[6],U.__data[9]=H.elements[7],U.__data[10]=H.elements[8],U.__data[11]=0):(H.toArray(U.__data,I),I+=K.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,q,U.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function f(v,x,S,P){let T=v.value,R=x+"_"+S;if(P[R]===void 0)return typeof T=="number"||typeof T=="boolean"?P[R]=T:P[R]=T.clone(),!0;{let F=P[R];if(typeof T=="number"||typeof T=="boolean"){if(F!==T)return P[R]=T,!0}else if(F.equals(T)===!1)return F.copy(T),!0}return!1}function m(v){let x=v.uniforms,S=0,P=16;for(let R=0,F=x.length;R<F;R++){let M=Array.isArray(x[R])?x[R]:[x[R]];for(let w=0,U=M.length;w<U;w++){let q=M[w],re=Array.isArray(q.value)?q.value:[q.value];for(let I=0,O=re.length;I<O;I++){let H=re[I],K=_(H),Y=S%P;Y!==0&&P-Y<K.boundary&&(S+=P-Y),q.__data=new Float32Array(K.storage/Float32Array.BYTES_PER_ELEMENT),q.__offset=S,S+=K.storage}}}let T=S%P;return T>0&&(S+=P-T),v.__size=S,v.__cache={},this}function _(v){let x={boundary:0,storage:0};return typeof v=="number"||typeof v=="boolean"?(x.boundary=4,x.storage=4):v.isVector2?(x.boundary=8,x.storage=8):v.isVector3||v.isColor?(x.boundary=16,x.storage=12):v.isVector4?(x.boundary=16,x.storage=16):v.isMatrix3?(x.boundary=48,x.storage=48):v.isMatrix4?(x.boundary=64,x.storage=64):v.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",v),x}function g(v){let x=v.target;x.removeEventListener("dispose",g);let S=o.indexOf(x.__bindingPointIndex);o.splice(S,1),i.deleteBuffer(s[x.id]),delete s[x.id],delete r[x.id]}function p(){for(let v in s)i.deleteBuffer(s[v]);o=[],s={},r={}}return{bind:c,update:l,dispose:p}}var Co=class{constructor(e={}){let{canvas:t=A0(),context:n=null,depth:s=!0,stencil:r=!0,alpha:o=!1,antialias:a=!1,premultipliedAlpha:c=!0,preserveDrawingBuffer:l=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1}=e;this.isWebGLRenderer=!0;let d;n!==null?d=n.getContextAttributes().alpha:d=o;let f=new Uint32Array(4),m=new Int32Array(4),_=null,g=null,p=[],v=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=_t,this._useLegacyLights=!1,this.toneMapping=ri,this.toneMappingExposure=1;let x=this,S=!1,P=0,T=0,R=null,F=-1,M=null,w=new yt,U=new yt,q=null,re=new Ee(0),I=0,O=t.width,H=t.height,K=1,Y=null,V=null,ee=new yt(0,0,O,H),te=new yt(0,0,O,H),me=!1,G=new Ro,J=!1,ge=!1,Ae=null,ye=new De,Fe=new se,Ve=new A,Re={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};function He(){return R===null?K:1}let C=n;function ce(b,D){for(let k=0;k<b.length;k++){let z=b[k],B=t.getContext(z,D);if(B!==null)return B}return null}try{let b={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:c,preserveDrawingBuffer:l,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${Nh}`),t.addEventListener("webglcontextlost",le,!1),t.addEventListener("webglcontextrestored",L,!1),t.addEventListener("webglcontextcreationerror",fe,!1),C===null){let D=["webgl2","webgl","experimental-webgl"];if(x.isWebGL1Renderer===!0&&D.shift(),C=ce(D,b),C===null)throw ce(D)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}typeof WebGLRenderingContext<"u"&&C instanceof WebGLRenderingContext&&console.warn("THREE.WebGLRenderer: WebGL 1 support was deprecated in r153 and will be removed in r163."),C.getShaderPrecisionFormat===void 0&&(C.getShaderPrecisionFormat=function(){return{rangeMin:1,rangeMax:1,precision:1}})}catch(b){throw console.error("THREE.WebGLRenderer: "+b.message),b}let X,oe,W,Le,_e,E,y,N,ne,j,$,we,de,ve,Ne,Xe,Q,dt,et,Ge,Ie,Se,Ye,mt;function It(){X=new Fy(C),oe=new Ly(C,X,e),X.init(oe),Se=new mM(C,X,oe),W=new fM(C,X,oe),Le=new zy(C),_e=new tM,E=new pM(C,X,W,_e,oe,Se,Le),y=new Dy(x),N=new Oy(x),ne=new Z0(C,oe),Ye=new Cy(C,X,ne,oe),j=new By(C,ne,Le,Ye),$=new Wy(C,j,ne,Le),et=new Vy(C,oe,E),Xe=new Iy(_e),we=new eM(x,y,N,X,oe,Ye,Xe),de=new _M(x,_e),ve=new iM,Ne=new lM(X,oe),dt=new Ry(x,y,N,W,$,d,c),Q=new dM(x,$,oe),mt=new xM(C,Le,oe,W),Ge=new Py(C,X,Le,oe),Ie=new ky(C,X,Le,oe),Le.programs=we.programs,x.capabilities=oe,x.extensions=X,x.properties=_e,x.renderLists=ve,x.shadowMap=Q,x.state=W,x.info=Le}It();let $e=new uh(x,C);this.xr=$e,this.getContext=function(){return C},this.getContextAttributes=function(){return C.getContextAttributes()},this.forceContextLoss=function(){let b=X.get("WEBGL_lose_context");b&&b.loseContext()},this.forceContextRestore=function(){let b=X.get("WEBGL_lose_context");b&&b.restoreContext()},this.getPixelRatio=function(){return K},this.setPixelRatio=function(b){b!==void 0&&(K=b,this.setSize(O,H,!1))},this.getSize=function(b){return b.set(O,H)},this.setSize=function(b,D,k=!0){if($e.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}O=b,H=D,t.width=Math.floor(b*K),t.height=Math.floor(D*K),k===!0&&(t.style.width=b+"px",t.style.height=D+"px"),this.setViewport(0,0,b,D)},this.getDrawingBufferSize=function(b){return b.set(O*K,H*K).floor()},this.setDrawingBufferSize=function(b,D,k){O=b,H=D,K=k,t.width=Math.floor(b*k),t.height=Math.floor(D*k),this.setViewport(0,0,b,D)},this.getCurrentViewport=function(b){return b.copy(w)},this.getViewport=function(b){return b.copy(ee)},this.setViewport=function(b,D,k,z){b.isVector4?ee.set(b.x,b.y,b.z,b.w):ee.set(b,D,k,z),W.viewport(w.copy(ee).multiplyScalar(K).floor())},this.getScissor=function(b){return b.copy(te)},this.setScissor=function(b,D,k,z){b.isVector4?te.set(b.x,b.y,b.z,b.w):te.set(b,D,k,z),W.scissor(U.copy(te).multiplyScalar(K).floor())},this.getScissorTest=function(){return me},this.setScissorTest=function(b){W.setScissorTest(me=b)},this.setOpaqueSort=function(b){Y=b},this.setTransparentSort=function(b){V=b},this.getClearColor=function(b){return b.copy(dt.getClearColor())},this.setClearColor=function(){dt.setClearColor.apply(dt,arguments)},this.getClearAlpha=function(){return dt.getClearAlpha()},this.setClearAlpha=function(){dt.setClearAlpha.apply(dt,arguments)},this.clear=function(b=!0,D=!0,k=!0){let z=0;if(b){let B=!1;if(R!==null){let xe=R.texture.format;B=xe===_p||xe===gp||xe===mp}if(B){let xe=R.texture.type,Pe=xe===Yi||xe===Wi||xe===Fh||xe===ws||xe===fp||xe===pp,Oe=dt.getClearColor(),ke=dt.getClearAlpha(),Ke=Oe.r,We=Oe.g,qe=Oe.b;Pe?(f[0]=Ke,f[1]=We,f[2]=qe,f[3]=ke,C.clearBufferuiv(C.COLOR,0,f)):(m[0]=Ke,m[1]=We,m[2]=qe,m[3]=ke,C.clearBufferiv(C.COLOR,0,m))}else z|=C.COLOR_BUFFER_BIT}D&&(z|=C.DEPTH_BUFFER_BIT),k&&(z|=C.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),C.clear(z)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",le,!1),t.removeEventListener("webglcontextrestored",L,!1),t.removeEventListener("webglcontextcreationerror",fe,!1),ve.dispose(),Ne.dispose(),_e.dispose(),y.dispose(),N.dispose(),$.dispose(),Ye.dispose(),mt.dispose(),we.dispose(),$e.dispose(),$e.removeEventListener("sessionstart",fn),$e.removeEventListener("sessionend",Et),Ae&&(Ae.dispose(),Ae=null),pn.stop()};function le(b){b.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),S=!0}function L(){console.log("THREE.WebGLRenderer: Context Restored."),S=!1;let b=Le.autoReset,D=Q.enabled,k=Q.autoUpdate,z=Q.needsUpdate,B=Q.type;It(),Le.autoReset=b,Q.enabled=D,Q.autoUpdate=k,Q.needsUpdate=z,Q.type=B}function fe(b){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",b.statusMessage)}function pe(b){let D=b.target;D.removeEventListener("dispose",pe),Be(D)}function Be(b){Ue(b),_e.remove(b)}function Ue(b){let D=_e.get(b).programs;D!==void 0&&(D.forEach(function(k){we.releaseProgram(k)}),b.isShaderMaterial&&we.releaseShaderCache(b))}this.renderBufferDirect=function(b,D,k,z,B,xe){D===null&&(D=Re);let Pe=B.isMesh&&B.matrixWorld.determinant()<0,Oe=cg(b,D,k,z,B);W.setMaterial(z,Pe);let ke=k.index,Ke=1;if(z.wireframe===!0){if(ke=j.getWireframeAttribute(k),ke===void 0)return;Ke=2}let We=k.drawRange,qe=k.attributes.position,Ut=We.start*Ke,Tn=(We.start+We.count)*Ke;xe!==null&&(Ut=Math.max(Ut,xe.start*Ke),Tn=Math.min(Tn,(xe.start+xe.count)*Ke)),ke!==null?(Ut=Math.max(Ut,0),Tn=Math.min(Tn,ke.count)):qe!=null&&(Ut=Math.max(Ut,0),Tn=Math.min(Tn,qe.count));let Zt=Tn-Ut;if(Zt<0||Zt===1/0)return;Ye.setup(B,z,Oe,k,ke);let mi,Ct=Ge;if(ke!==null&&(mi=ne.get(ke),Ct=Ie,Ct.setIndex(mi)),B.isMesh)z.wireframe===!0?(W.setLineWidth(z.wireframeLinewidth*He()),Ct.setMode(C.LINES)):Ct.setMode(C.TRIANGLES);else if(B.isLine){let Je=z.linewidth;Je===void 0&&(Je=1),W.setLineWidth(Je*He()),B.isLineSegments?Ct.setMode(C.LINES):B.isLineLoop?Ct.setMode(C.LINE_LOOP):Ct.setMode(C.LINE_STRIP)}else B.isPoints?Ct.setMode(C.POINTS):B.isSprite&&Ct.setMode(C.TRIANGLES);if(B.isBatchedMesh)Ct.renderMultiDraw(B._multiDrawStarts,B._multiDrawCounts,B._multiDrawCount);else if(B.isInstancedMesh)Ct.renderInstances(Ut,Zt,B.count);else if(k.isInstancedBufferGeometry){let Je=k._maxInstanceCount!==void 0?k._maxInstanceCount:1/0,sl=Math.min(k.instanceCount,Je);Ct.renderInstances(Ut,Zt,sl)}else Ct.render(Ut,Zt)};function Mt(b,D,k){b.transparent===!0&&b.side===Jt&&b.forceSinglePass===!1?(b.side=Mn,b.needsUpdate=!0,ia(b,D,k),b.side=oi,b.needsUpdate=!0,ia(b,D,k),b.side=Jt):ia(b,D,k)}this.compile=function(b,D,k=null){k===null&&(k=b),g=Ne.get(k),g.init(),v.push(g),k.traverseVisible(function(B){B.isLight&&B.layers.test(D.layers)&&(g.pushLight(B),B.castShadow&&g.pushShadow(B))}),b!==k&&b.traverseVisible(function(B){B.isLight&&B.layers.test(D.layers)&&(g.pushLight(B),B.castShadow&&g.pushShadow(B))}),g.setupLights(x._useLegacyLights);let z=new Set;return b.traverse(function(B){let xe=B.material;if(xe)if(Array.isArray(xe))for(let Pe=0;Pe<xe.length;Pe++){let Oe=xe[Pe];Mt(Oe,k,B),z.add(Oe)}else Mt(xe,k,B),z.add(xe)}),v.pop(),g=null,z},this.compileAsync=function(b,D,k=null){let z=this.compile(b,D,k);return new Promise(B=>{function xe(){if(z.forEach(function(Pe){_e.get(Pe).currentProgram.isReady()&&z.delete(Pe)}),z.size===0){B(b);return}setTimeout(xe,10)}X.get("KHR_parallel_shader_compile")!==null?xe():setTimeout(xe,10)})};let St=null;function Yt(b){St&&St(b)}function fn(){pn.stop()}function Et(){pn.start()}let pn=new Tp;pn.setAnimationLoop(Yt),typeof self<"u"&&pn.setContext(self),this.setAnimationLoop=function(b){St=b,$e.setAnimationLoop(b),b===null?pn.stop():pn.start()},$e.addEventListener("sessionstart",fn),$e.addEventListener("sessionend",Et),this.render=function(b,D){if(D!==void 0&&D.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(S===!0)return;b.matrixWorldAutoUpdate===!0&&b.updateMatrixWorld(),D.parent===null&&D.matrixWorldAutoUpdate===!0&&D.updateMatrixWorld(),$e.enabled===!0&&$e.isPresenting===!0&&($e.cameraAutoUpdate===!0&&$e.updateCamera(D),D=$e.getCamera()),b.isScene===!0&&b.onBeforeRender(x,b,D,R),g=Ne.get(b,v.length),g.init(),v.push(g),ye.multiplyMatrices(D.projectionMatrix,D.matrixWorldInverse),G.setFromProjectionMatrix(ye),ge=this.localClippingEnabled,J=Xe.init(this.clippingPlanes,ge),_=ve.get(b,p.length),_.init(),p.push(_),ni(b,D,0,x.sortObjects),_.finish(),x.sortObjects===!0&&_.sort(Y,V),this.info.render.frame++,J===!0&&Xe.beginShadows();let k=g.state.shadowsArray;if(Q.render(k,b,D),J===!0&&Xe.endShadows(),this.info.autoReset===!0&&this.info.reset(),dt.render(_,b),g.setupLights(x._useLegacyLights),D.isArrayCamera){let z=D.cameras;for(let B=0,xe=z.length;B<xe;B++){let Pe=z[B];fd(_,b,Pe,Pe.viewport)}}else fd(_,b,D);R!==null&&(E.updateMultisampleRenderTarget(R),E.updateRenderTargetMipmap(R)),b.isScene===!0&&b.onAfterRender(x,b,D),Ye.resetDefaultState(),F=-1,M=null,v.pop(),v.length>0?g=v[v.length-1]:g=null,p.pop(),p.length>0?_=p[p.length-1]:_=null};function ni(b,D,k,z){if(b.visible===!1)return;if(b.layers.test(D.layers)){if(b.isGroup)k=b.renderOrder;else if(b.isLOD)b.autoUpdate===!0&&b.update(D);else if(b.isLight)g.pushLight(b),b.castShadow&&g.pushShadow(b);else if(b.isSprite){if(!b.frustumCulled||G.intersectsSprite(b)){z&&Ve.setFromMatrixPosition(b.matrixWorld).applyMatrix4(ye);let Pe=$.update(b),Oe=b.material;Oe.visible&&_.push(b,Pe,Oe,k,Ve.z,null)}}else if((b.isMesh||b.isLine||b.isPoints)&&(!b.frustumCulled||G.intersectsObject(b))){let Pe=$.update(b),Oe=b.material;if(z&&(b.boundingSphere!==void 0?(b.boundingSphere===null&&b.computeBoundingSphere(),Ve.copy(b.boundingSphere.center)):(Pe.boundingSphere===null&&Pe.computeBoundingSphere(),Ve.copy(Pe.boundingSphere.center)),Ve.applyMatrix4(b.matrixWorld).applyMatrix4(ye)),Array.isArray(Oe)){let ke=Pe.groups;for(let Ke=0,We=ke.length;Ke<We;Ke++){let qe=ke[Ke],Ut=Oe[qe.materialIndex];Ut&&Ut.visible&&_.push(b,Pe,Ut,k,Ve.z,qe)}}else Oe.visible&&_.push(b,Pe,Oe,k,Ve.z,null)}}let xe=b.children;for(let Pe=0,Oe=xe.length;Pe<Oe;Pe++)ni(xe[Pe],D,k,z)}function fd(b,D,k,z){let B=b.opaque,xe=b.transmissive,Pe=b.transparent;g.setupLightsView(k),J===!0&&Xe.setGlobalState(x.clippingPlanes,k),xe.length>0&&ag(B,xe,D,k),z&&W.viewport(w.copy(z)),B.length>0&&na(B,D,k),xe.length>0&&na(xe,D,k),Pe.length>0&&na(Pe,D,k),W.buffers.depth.setTest(!0),W.buffers.depth.setMask(!0),W.buffers.color.setMask(!0),W.setPolygonOffset(!1)}function ag(b,D,k,z){if((k.isScene===!0?k.overrideMaterial:null)!==null)return;let xe=oe.isWebGL2;Ae===null&&(Ae=new Ri(1,1,{generateMipmaps:!0,type:X.has("EXT_color_buffer_half_float")?wo:Yi,minFilter:Ki,samples:xe?4:0})),x.getDrawingBufferSize(Fe),xe?Ae.setSize(Fe.x,Fe.y):Ae.setSize(Xa(Fe.x),Xa(Fe.y));let Pe=x.getRenderTarget();x.setRenderTarget(Ae),x.getClearColor(re),I=x.getClearAlpha(),I<1&&x.setClearColor(16777215,.5),x.clear();let Oe=x.toneMapping;x.toneMapping=ri,na(b,k,z),E.updateMultisampleRenderTarget(Ae),E.updateRenderTargetMipmap(Ae);let ke=!1;for(let Ke=0,We=D.length;Ke<We;Ke++){let qe=D[Ke],Ut=qe.object,Tn=qe.geometry,Zt=qe.material,mi=qe.group;if(Zt.side===Jt&&Ut.layers.test(z.layers)){let Ct=Zt.side;Zt.side=Mn,Zt.needsUpdate=!0,pd(Ut,k,z,Tn,Zt,mi),Zt.side=Ct,Zt.needsUpdate=!0,ke=!0}}ke===!0&&(E.updateMultisampleRenderTarget(Ae),E.updateRenderTargetMipmap(Ae)),x.setRenderTarget(Pe),x.setClearColor(re,I),x.toneMapping=Oe}function na(b,D,k){let z=D.isScene===!0?D.overrideMaterial:null;for(let B=0,xe=b.length;B<xe;B++){let Pe=b[B],Oe=Pe.object,ke=Pe.geometry,Ke=z===null?Pe.material:z,We=Pe.group;Oe.layers.test(k.layers)&&pd(Oe,D,k,ke,Ke,We)}}function pd(b,D,k,z,B,xe){b.onBeforeRender(x,D,k,z,B,xe),b.modelViewMatrix.multiplyMatrices(k.matrixWorldInverse,b.matrixWorld),b.normalMatrix.getNormalMatrix(b.modelViewMatrix),B.onBeforeRender(x,D,k,z,b,xe),B.transparent===!0&&B.side===Jt&&B.forceSinglePass===!1?(B.side=Mn,B.needsUpdate=!0,x.renderBufferDirect(k,D,z,B,b,xe),B.side=oi,B.needsUpdate=!0,x.renderBufferDirect(k,D,z,B,b,xe),B.side=Jt):x.renderBufferDirect(k,D,z,B,b,xe),b.onAfterRender(x,D,k,z,B,xe)}function ia(b,D,k){D.isScene!==!0&&(D=Re);let z=_e.get(b),B=g.state.lights,xe=g.state.shadowsArray,Pe=B.state.version,Oe=we.getParameters(b,B.state,xe,D,k),ke=we.getProgramCacheKey(Oe),Ke=z.programs;z.environment=b.isMeshStandardMaterial?D.environment:null,z.fog=D.fog,z.envMap=(b.isMeshStandardMaterial?N:y).get(b.envMap||z.environment),Ke===void 0&&(b.addEventListener("dispose",pe),Ke=new Map,z.programs=Ke);let We=Ke.get(ke);if(We!==void 0){if(z.currentProgram===We&&z.lightsStateVersion===Pe)return gd(b,Oe),We}else Oe.uniforms=we.getUniforms(b),b.onBuild(k,Oe,x),b.onBeforeCompile(Oe,x),We=we.acquireProgram(Oe,ke),Ke.set(ke,We),z.uniforms=Oe.uniforms;let qe=z.uniforms;return(!b.isShaderMaterial&&!b.isRawShaderMaterial||b.clipping===!0)&&(qe.clippingPlanes=Xe.uniform),gd(b,Oe),z.needsLights=hg(b),z.lightsStateVersion=Pe,z.needsLights&&(qe.ambientLightColor.value=B.state.ambient,qe.lightProbe.value=B.state.probe,qe.directionalLights.value=B.state.directional,qe.directionalLightShadows.value=B.state.directionalShadow,qe.spotLights.value=B.state.spot,qe.spotLightShadows.value=B.state.spotShadow,qe.rectAreaLights.value=B.state.rectArea,qe.ltc_1.value=B.state.rectAreaLTC1,qe.ltc_2.value=B.state.rectAreaLTC2,qe.pointLights.value=B.state.point,qe.pointLightShadows.value=B.state.pointShadow,qe.hemisphereLights.value=B.state.hemi,qe.directionalShadowMap.value=B.state.directionalShadowMap,qe.directionalShadowMatrix.value=B.state.directionalShadowMatrix,qe.spotShadowMap.value=B.state.spotShadowMap,qe.spotLightMatrix.value=B.state.spotLightMatrix,qe.spotLightMap.value=B.state.spotLightMap,qe.pointShadowMap.value=B.state.pointShadowMap,qe.pointShadowMatrix.value=B.state.pointShadowMatrix),z.currentProgram=We,z.uniformsList=null,We}function md(b){if(b.uniformsList===null){let D=b.currentProgram.getUniforms();b.uniformsList=Sr.seqWithValue(D.seq,b.uniforms)}return b.uniformsList}function gd(b,D){let k=_e.get(b);k.outputColorSpace=D.outputColorSpace,k.batching=D.batching,k.instancing=D.instancing,k.instancingColor=D.instancingColor,k.skinning=D.skinning,k.morphTargets=D.morphTargets,k.morphNormals=D.morphNormals,k.morphColors=D.morphColors,k.morphTargetsCount=D.morphTargetsCount,k.numClippingPlanes=D.numClippingPlanes,k.numIntersection=D.numClipIntersection,k.vertexAlphas=D.vertexAlphas,k.vertexTangents=D.vertexTangents,k.toneMapping=D.toneMapping}function cg(b,D,k,z,B){D.isScene!==!0&&(D=Re),E.resetTextureUnits();let xe=D.fog,Pe=z.isMeshStandardMaterial?D.environment:null,Oe=R===null?x.outputColorSpace:R.isXRRenderTarget===!0?R.texture.colorSpace:Ht,ke=(z.isMeshStandardMaterial?N:y).get(z.envMap||Pe),Ke=z.vertexColors===!0&&!!k.attributes.color&&k.attributes.color.itemSize===4,We=!!k.attributes.tangent&&(!!z.normalMap||z.anisotropy>0),qe=!!k.morphAttributes.position,Ut=!!k.morphAttributes.normal,Tn=!!k.morphAttributes.color,Zt=ri;z.toneMapped&&(R===null||R.isXRRenderTarget===!0)&&(Zt=x.toneMapping);let mi=k.morphAttributes.position||k.morphAttributes.normal||k.morphAttributes.color,Ct=mi!==void 0?mi.length:0,Je=_e.get(z),sl=g.state.lights;if(J===!0&&(ge===!0||b!==M)){let On=b===M&&z.id===F;Xe.setState(z,b,On)}let Dt=!1;z.version===Je.__version?(Je.needsLights&&Je.lightsStateVersion!==sl.state.version||Je.outputColorSpace!==Oe||B.isBatchedMesh&&Je.batching===!1||!B.isBatchedMesh&&Je.batching===!0||B.isInstancedMesh&&Je.instancing===!1||!B.isInstancedMesh&&Je.instancing===!0||B.isSkinnedMesh&&Je.skinning===!1||!B.isSkinnedMesh&&Je.skinning===!0||B.isInstancedMesh&&Je.instancingColor===!0&&B.instanceColor===null||B.isInstancedMesh&&Je.instancingColor===!1&&B.instanceColor!==null||Je.envMap!==ke||z.fog===!0&&Je.fog!==xe||Je.numClippingPlanes!==void 0&&(Je.numClippingPlanes!==Xe.numPlanes||Je.numIntersection!==Xe.numIntersection)||Je.vertexAlphas!==Ke||Je.vertexTangents!==We||Je.morphTargets!==qe||Je.morphNormals!==Ut||Je.morphColors!==Tn||Je.toneMapping!==Zt||oe.isWebGL2===!0&&Je.morphTargetsCount!==Ct)&&(Dt=!0):(Dt=!0,Je.__version=z.version);let ms=Je.currentProgram;Dt===!0&&(ms=ia(z,D,B));let _d=!1,lo=!1,rl=!1,an=ms.getUniforms(),gs=Je.uniforms;if(W.useProgram(ms.program)&&(_d=!0,lo=!0,rl=!0),z.id!==F&&(F=z.id,lo=!0),_d||M!==b){an.setValue(C,"projectionMatrix",b.projectionMatrix),an.setValue(C,"viewMatrix",b.matrixWorldInverse);let On=an.map.cameraPosition;On!==void 0&&On.setValue(C,Ve.setFromMatrixPosition(b.matrixWorld)),oe.logarithmicDepthBuffer&&an.setValue(C,"logDepthBufFC",2/(Math.log(b.far+1)/Math.LN2)),(z.isMeshPhongMaterial||z.isMeshToonMaterial||z.isMeshLambertMaterial||z.isMeshBasicMaterial||z.isMeshStandardMaterial||z.isShaderMaterial)&&an.setValue(C,"isOrthographic",b.isOrthographicCamera===!0),M!==b&&(M=b,lo=!0,rl=!0)}if(B.isSkinnedMesh){an.setOptional(C,B,"bindMatrix"),an.setOptional(C,B,"bindMatrixInverse");let On=B.skeleton;On&&(oe.floatVertexTextures?(On.boneTexture===null&&On.computeBoneTexture(),an.setValue(C,"boneTexture",On.boneTexture,E)):console.warn("THREE.WebGLRenderer: SkinnedMesh can only be used with WebGL 2. With WebGL 1 OES_texture_float and vertex textures support is required."))}B.isBatchedMesh&&(an.setOptional(C,B,"batchingTexture"),an.setValue(C,"batchingTexture",B._matricesTexture,E));let ol=k.morphAttributes;if((ol.position!==void 0||ol.normal!==void 0||ol.color!==void 0&&oe.isWebGL2===!0)&&et.update(B,k,ms),(lo||Je.receiveShadow!==B.receiveShadow)&&(Je.receiveShadow=B.receiveShadow,an.setValue(C,"receiveShadow",B.receiveShadow)),z.isMeshGouraudMaterial&&z.envMap!==null&&(gs.envMap.value=ke,gs.flipEnvMap.value=ke.isCubeTexture&&ke.isRenderTargetTexture===!1?-1:1),lo&&(an.setValue(C,"toneMappingExposure",x.toneMappingExposure),Je.needsLights&&lg(gs,rl),xe&&z.fog===!0&&de.refreshFogUniforms(gs,xe),de.refreshMaterialUniforms(gs,z,K,H,Ae),Sr.upload(C,md(Je),gs,E)),z.isShaderMaterial&&z.uniformsNeedUpdate===!0&&(Sr.upload(C,md(Je),gs,E),z.uniformsNeedUpdate=!1),z.isSpriteMaterial&&an.setValue(C,"center",B.center),an.setValue(C,"modelViewMatrix",B.modelViewMatrix),an.setValue(C,"normalMatrix",B.normalMatrix),an.setValue(C,"modelMatrix",B.matrixWorld),z.isShaderMaterial||z.isRawShaderMaterial){let On=z.uniformsGroups;for(let al=0,ug=On.length;al<ug;al++)if(oe.isWebGL2){let xd=On[al];mt.update(xd,ms),mt.bind(xd,ms)}else console.warn("THREE.WebGLRenderer: Uniform Buffer Objects can only be used with WebGL 2.")}return ms}function lg(b,D){b.ambientLightColor.needsUpdate=D,b.lightProbe.needsUpdate=D,b.directionalLights.needsUpdate=D,b.directionalLightShadows.needsUpdate=D,b.pointLights.needsUpdate=D,b.pointLightShadows.needsUpdate=D,b.spotLights.needsUpdate=D,b.spotLightShadows.needsUpdate=D,b.rectAreaLights.needsUpdate=D,b.hemisphereLights.needsUpdate=D}function hg(b){return b.isMeshLambertMaterial||b.isMeshToonMaterial||b.isMeshPhongMaterial||b.isMeshStandardMaterial||b.isShadowMaterial||b.isShaderMaterial&&b.lights===!0}this.getActiveCubeFace=function(){return P},this.getActiveMipmapLevel=function(){return T},this.getRenderTarget=function(){return R},this.setRenderTargetTextures=function(b,D,k){_e.get(b.texture).__webglTexture=D,_e.get(b.depthTexture).__webglTexture=k;let z=_e.get(b);z.__hasExternalTextures=!0,z.__hasExternalTextures&&(z.__autoAllocateDepthBuffer=k===void 0,z.__autoAllocateDepthBuffer||X.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),z.__useRenderToTexture=!1))},this.setRenderTargetFramebuffer=function(b,D){let k=_e.get(b);k.__webglFramebuffer=D,k.__useDefaultFramebuffer=D===void 0},this.setRenderTarget=function(b,D=0,k=0){R=b,P=D,T=k;let z=!0,B=null,xe=!1,Pe=!1;if(b){let ke=_e.get(b);ke.__useDefaultFramebuffer!==void 0?(W.bindFramebuffer(C.FRAMEBUFFER,null),z=!1):ke.__webglFramebuffer===void 0?E.setupRenderTarget(b):ke.__hasExternalTextures&&E.rebindTextures(b,_e.get(b.texture).__webglTexture,_e.get(b.depthTexture).__webglTexture);let Ke=b.texture;(Ke.isData3DTexture||Ke.isDataArrayTexture||Ke.isCompressedArrayTexture)&&(Pe=!0);let We=_e.get(b).__webglFramebuffer;b.isWebGLCubeRenderTarget?(Array.isArray(We[D])?B=We[D][k]:B=We[D],xe=!0):oe.isWebGL2&&b.samples>0&&E.useMultisampledRTT(b)===!1?B=_e.get(b).__webglMultisampledFramebuffer:Array.isArray(We)?B=We[k]:B=We,w.copy(b.viewport),U.copy(b.scissor),q=b.scissorTest}else w.copy(ee).multiplyScalar(K).floor(),U.copy(te).multiplyScalar(K).floor(),q=me;if(W.bindFramebuffer(C.FRAMEBUFFER,B)&&oe.drawBuffers&&z&&W.drawBuffers(b,B),W.viewport(w),W.scissor(U),W.setScissorTest(q),xe){let ke=_e.get(b.texture);C.framebufferTexture2D(C.FRAMEBUFFER,C.COLOR_ATTACHMENT0,C.TEXTURE_CUBE_MAP_POSITIVE_X+D,ke.__webglTexture,k)}else if(Pe){let ke=_e.get(b.texture),Ke=D||0;C.framebufferTextureLayer(C.FRAMEBUFFER,C.COLOR_ATTACHMENT0,ke.__webglTexture,k||0,Ke)}F=-1},this.readRenderTargetPixels=function(b,D,k,z,B,xe,Pe){if(!(b&&b.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Oe=_e.get(b).__webglFramebuffer;if(b.isWebGLCubeRenderTarget&&Pe!==void 0&&(Oe=Oe[Pe]),Oe){W.bindFramebuffer(C.FRAMEBUFFER,Oe);try{let ke=b.texture,Ke=ke.format,We=ke.type;if(Ke!==Bn&&Se.convert(Ke)!==C.getParameter(C.IMPLEMENTATION_COLOR_READ_FORMAT)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}let qe=We===wo&&(X.has("EXT_color_buffer_half_float")||oe.isWebGL2&&X.has("EXT_color_buffer_float"));if(We!==Yi&&Se.convert(We)!==C.getParameter(C.IMPLEMENTATION_COLOR_READ_TYPE)&&!(We===bi&&(oe.isWebGL2||X.has("OES_texture_float")||X.has("WEBGL_color_buffer_float")))&&!qe){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}D>=0&&D<=b.width-z&&k>=0&&k<=b.height-B&&C.readPixels(D,k,z,B,Se.convert(Ke),Se.convert(We),xe)}finally{let ke=R!==null?_e.get(R).__webglFramebuffer:null;W.bindFramebuffer(C.FRAMEBUFFER,ke)}}},this.copyFramebufferToTexture=function(b,D,k=0){let z=Math.pow(2,-k),B=Math.floor(D.image.width*z),xe=Math.floor(D.image.height*z);E.setTexture2D(D,0),C.copyTexSubImage2D(C.TEXTURE_2D,k,0,0,b.x,b.y,B,xe),W.unbindTexture()},this.copyTextureToTexture=function(b,D,k,z=0){let B=D.image.width,xe=D.image.height,Pe=Se.convert(k.format),Oe=Se.convert(k.type);E.setTexture2D(k,0),C.pixelStorei(C.UNPACK_FLIP_Y_WEBGL,k.flipY),C.pixelStorei(C.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),C.pixelStorei(C.UNPACK_ALIGNMENT,k.unpackAlignment),D.isDataTexture?C.texSubImage2D(C.TEXTURE_2D,z,b.x,b.y,B,xe,Pe,Oe,D.image.data):D.isCompressedTexture?C.compressedTexSubImage2D(C.TEXTURE_2D,z,b.x,b.y,D.mipmaps[0].width,D.mipmaps[0].height,Pe,D.mipmaps[0].data):C.texSubImage2D(C.TEXTURE_2D,z,b.x,b.y,Pe,Oe,D.image),z===0&&k.generateMipmaps&&C.generateMipmap(C.TEXTURE_2D),W.unbindTexture()},this.copyTextureToTexture3D=function(b,D,k,z,B=0){if(x.isWebGL1Renderer){console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: can only be used with WebGL2.");return}let xe=b.max.x-b.min.x+1,Pe=b.max.y-b.min.y+1,Oe=b.max.z-b.min.z+1,ke=Se.convert(z.format),Ke=Se.convert(z.type),We;if(z.isData3DTexture)E.setTexture3D(z,0),We=C.TEXTURE_3D;else if(z.isDataArrayTexture||z.isCompressedArrayTexture)E.setTexture2DArray(z,0),We=C.TEXTURE_2D_ARRAY;else{console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");return}C.pixelStorei(C.UNPACK_FLIP_Y_WEBGL,z.flipY),C.pixelStorei(C.UNPACK_PREMULTIPLY_ALPHA_WEBGL,z.premultiplyAlpha),C.pixelStorei(C.UNPACK_ALIGNMENT,z.unpackAlignment);let qe=C.getParameter(C.UNPACK_ROW_LENGTH),Ut=C.getParameter(C.UNPACK_IMAGE_HEIGHT),Tn=C.getParameter(C.UNPACK_SKIP_PIXELS),Zt=C.getParameter(C.UNPACK_SKIP_ROWS),mi=C.getParameter(C.UNPACK_SKIP_IMAGES),Ct=k.isCompressedTexture?k.mipmaps[B]:k.image;C.pixelStorei(C.UNPACK_ROW_LENGTH,Ct.width),C.pixelStorei(C.UNPACK_IMAGE_HEIGHT,Ct.height),C.pixelStorei(C.UNPACK_SKIP_PIXELS,b.min.x),C.pixelStorei(C.UNPACK_SKIP_ROWS,b.min.y),C.pixelStorei(C.UNPACK_SKIP_IMAGES,b.min.z),k.isDataTexture||k.isData3DTexture?C.texSubImage3D(We,B,D.x,D.y,D.z,xe,Pe,Oe,ke,Ke,Ct.data):k.isCompressedArrayTexture?(console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: untested support for compressed srcTexture."),C.compressedTexSubImage3D(We,B,D.x,D.y,D.z,xe,Pe,Oe,ke,Ct.data)):C.texSubImage3D(We,B,D.x,D.y,D.z,xe,Pe,Oe,ke,Ke,Ct),C.pixelStorei(C.UNPACK_ROW_LENGTH,qe),C.pixelStorei(C.UNPACK_IMAGE_HEIGHT,Ut),C.pixelStorei(C.UNPACK_SKIP_PIXELS,Tn),C.pixelStorei(C.UNPACK_SKIP_ROWS,Zt),C.pixelStorei(C.UNPACK_SKIP_IMAGES,mi),B===0&&z.generateMipmaps&&C.generateMipmap(We),W.unbindTexture()},this.initTexture=function(b){b.isCubeTexture?E.setTextureCube(b,0):b.isData3DTexture?E.setTexture3D(b,0):b.isDataArrayTexture||b.isCompressedArrayTexture?E.setTexture2DArray(b,0):E.setTexture2D(b,0),W.unbindTexture()},this.resetState=function(){P=0,T=0,R=null,W.reset(),Ye.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return wi}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=e===zh?"display-p3":"srgb",t.unpackColorSpace=ft.workingColorSpace===Rc?"display-p3":"srgb"}get outputEncoding(){return console.warn("THREE.WebGLRenderer: Property .outputEncoding has been removed. Use .outputColorSpace instead."),this.outputColorSpace===_t?As:vp}set outputEncoding(e){console.warn("THREE.WebGLRenderer: Property .outputEncoding has been removed. Use .outputColorSpace instead."),this.outputColorSpace=e===As?_t:Ht}get useLegacyLights(){return console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights}set useLegacyLights(e){console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights=e}},dh=class extends Co{};dh.prototype.isWebGL1Renderer=!0;var tc=class extends Tt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t}},Po=class{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=Kl,this._updateRange={offset:0,count:-1},this.updateRanges=[],this.version=0,this.uuid=zn()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}get updateRange(){return console.warn("THREE.InterleavedBuffer: updateRange() is deprecated and will be removed in r169. Use addUpdateRange() instead."),this._updateRange}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let s=0,r=this.stride;s<r;s++)this.array[e+s]=t.array[n+s];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=zn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);let t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){return e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=zn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}},mn=new A,Lo=class i{constructor(e,t,n,s=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=s}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)mn.fromBufferAttribute(this,t),mn.applyMatrix4(e),this.setXYZ(t,mn.x,mn.y,mn.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)mn.fromBufferAttribute(this,t),mn.applyNormalMatrix(e),this.setXYZ(t,mn.x,mn.y,mn.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)mn.fromBufferAttribute(this,t),mn.transformDirection(e),this.setXYZ(t,mn.x,mn.y,mn.z);return this}setX(e,t){return this.normalized&&(t=gt(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=gt(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=gt(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=gt(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=si(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=si(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=si(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=si(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=gt(t,this.array),n=gt(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,s){return e=e*this.data.stride+this.offset,this.normalized&&(t=gt(t,this.array),n=gt(n,this.array),s=gt(s,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e=e*this.data.stride+this.offset,this.normalized&&(t=gt(t,this.array),n=gt(n,this.array),s=gt(s,this.array),r=gt(r,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this.data.array[e+3]=r,this}clone(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return new Ot(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new i(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}};var Bf=new A,kf=new yt,zf=new yt,yM=new A,Hf=new De,Ta=new A,Ol=new Pn,Gf=new De,Fl=new Cs,nc=class extends ae{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=wd,this.bindMatrix=new De,this.bindMatrixInverse=new De,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){let e=this.geometry;this.boundingBox===null&&(this.boundingBox=new hn),this.boundingBox.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,Ta),this.boundingBox.expandByPoint(Ta)}computeBoundingSphere(){let e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new Pn),this.boundingSphere.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,Ta),this.boundingSphere.expandByPoint(Ta)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}raycast(e,t){let n=this.material,s=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Ol.copy(this.boundingSphere),Ol.applyMatrix4(s),e.ray.intersectsSphere(Ol)!==!1&&(Gf.copy(s).invert(),Fl.copy(e.ray).applyMatrix4(Gf),!(this.boundingBox!==null&&Fl.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(e,t,Fl)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){let e=new yt,t=this.geometry.attributes.skinWeight;for(let n=0,s=t.count;n<s;n++){e.fromBufferAttribute(t,n);let r=1/e.manhattanLength();r!==1/0?e.multiplyScalar(r):e.set(1,0,0,0),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===wd?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===Xg?this.bindMatrixInverse.copy(this.bindMatrix).invert():console.warn("THREE.SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(e,t){let n=this.skeleton,s=this.geometry;kf.fromBufferAttribute(s.attributes.skinIndex,e),zf.fromBufferAttribute(s.attributes.skinWeight,e),Bf.copy(t).applyMatrix4(this.bindMatrix),t.set(0,0,0);for(let r=0;r<4;r++){let o=zf.getComponent(r);if(o!==0){let a=kf.getComponent(r);Hf.multiplyMatrices(n.bones[a].matrixWorld,n.boneInverses[a]),t.addScaledVector(yM.copy(Bf).applyMatrix4(Hf),o)}}return t.applyMatrix4(this.bindMatrixInverse)}boneTransform(e,t){return console.warn("THREE.SkinnedMesh: .boneTransform() was renamed to .applyBoneTransform() in r151."),this.applyBoneTransform(e,t)}},Io=class extends Tt{constructor(){super(),this.isBone=!0,this.type="Bone"}},fh=class extends nn{constructor(e=null,t=1,n=1,s,r,o,a,c,l=zt,h=zt,u,d){super(null,o,a,c,l,h,s,r,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Vf=new De,vM=new De,ic=class i{constructor(e=[],t=[]){this.uuid=zn(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){let e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){console.warn("THREE.Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,s=this.bones.length;n<s;n++)this.boneInverses.push(new De)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){let n=new De;this.bones[e]&&n.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&n.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){let e=this.bones,t=this.boneInverses,n=this.boneMatrices,s=this.boneTexture;for(let r=0,o=e.length;r<o;r++){let a=e[r]?e[r].matrixWorld:vM;Vf.multiplyMatrices(a,t[r]),Vf.toArray(n,r*16)}s!==null&&(s.needsUpdate=!0)}clone(){return new i(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);let t=new Float32Array(e*e*4);t.set(this.boneMatrices);let n=new fh(t,e,e,Bn,bi);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){let s=this.bones[t];if(s.name===e)return s}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,s=e.bones.length;n<s;n++){let r=e.bones[n],o=t[r];o===void 0&&(console.warn("THREE.Skeleton: No bone found with UUID:",r),o=new Io),this.bones.push(o),this.boneInverses.push(new De().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){let e={metadata:{version:4.6,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};e.uuid=this.uuid;let t=this.bones,n=this.boneInverses;for(let s=0,r=t.length;s<r;s++){let o=t[s];e.bones.push(o.uuid);let a=n[s];e.boneInverses.push(a.toArray())}return e}},Ps=class extends Ot{constructor(e,t,n,s=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=s}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},fr=new De,Wf=new De,Aa=[],Xf=new hn,MM=new De,mo=new ae,go=new Pn,Hn=class extends ae{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new Ps(new Float32Array(n*16),16),this.instanceColor=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let s=0;s<n;s++)this.setMatrixAt(s,MM)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new hn),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,fr),Xf.copy(e.boundingBox).applyMatrix4(fr),this.boundingBox.union(Xf)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new Pn),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,fr),go.copy(e.boundingSphere).applyMatrix4(fr),this.boundingSphere.union(go)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){t.fromArray(this.instanceMatrix.array,e*16)}raycast(e,t){let n=this.matrixWorld,s=this.count;if(mo.geometry=this.geometry,mo.material=this.material,mo.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),go.copy(this.boundingSphere),go.applyMatrix4(n),e.ray.intersectsSphere(go)!==!1))for(let r=0;r<s;r++){this.getMatrixAt(r,fr),Wf.multiplyMatrices(n,fr),mo.matrixWorld=Wf,mo.raycast(e,Aa);for(let o=0,a=Aa.length;o<a;o++){let c=Aa[o];c.instanceId=r,c.object=this,t.push(c)}Aa.length=0}}setColorAt(e,t){this.instanceColor===null&&(this.instanceColor=new Ps(new Float32Array(this.instanceMatrix.count*3),3)),t.toArray(this.instanceColor.array,e*3)}setMatrixAt(e,t){t.toArray(this.instanceMatrix.array,e*16)}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"})}};var Ji=class extends Ln{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Ee(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},qf=new A,Yf=new A,Zf=new De,Bl=new Cs,Ra=new Pn,Pr=class extends Tt{constructor(e=new Lt,t=new Ji){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let s=1,r=t.count;s<r;s++)qf.fromBufferAttribute(t,s-1),Yf.fromBufferAttribute(t,s),n[s]=n[s-1],n[s]+=qf.distanceTo(Yf);e.setAttribute("lineDistance",new lt(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Ra.copy(n.boundingSphere),Ra.applyMatrix4(s),Ra.radius+=r,e.ray.intersectsSphere(Ra)===!1)return;Zf.copy(s).invert(),Bl.copy(e.ray).applyMatrix4(Zf);let a=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=new A,h=new A,u=new A,d=new A,f=this.isLineSegments?2:1,m=n.index,g=n.attributes.position;if(m!==null){let p=Math.max(0,o.start),v=Math.min(m.count,o.start+o.count);for(let x=p,S=v-1;x<S;x+=f){let P=m.getX(x),T=m.getX(x+1);if(l.fromBufferAttribute(g,P),h.fromBufferAttribute(g,T),Bl.distanceSqToSegment(l,h,d,u)>c)continue;d.applyMatrix4(this.matrixWorld);let F=e.ray.origin.distanceTo(d);F<e.near||F>e.far||t.push({distance:F,point:u.clone().applyMatrix4(this.matrixWorld),index:x,face:null,faceIndex:null,object:this})}}else{let p=Math.max(0,o.start),v=Math.min(g.count,o.start+o.count);for(let x=p,S=v-1;x<S;x+=f){if(l.fromBufferAttribute(g,x),h.fromBufferAttribute(g,x+1),Bl.distanceSqToSegment(l,h,d,u)>c)continue;d.applyMatrix4(this.matrixWorld);let T=e.ray.origin.distanceTo(d);T<e.near||T>e.far||t.push({distance:T,point:u.clone().applyMatrix4(this.matrixWorld),index:x,face:null,faceIndex:null,object:this})}}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){let a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}},Kf=new A,$f=new A,Lr=class extends Pr{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[];for(let s=0,r=t.count;s<r;s+=2)Kf.fromBufferAttribute(t,s),$f.fromBufferAttribute(t,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+Kf.distanceTo($f);e.setAttribute("lineDistance",new lt(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}},Ir=class extends Pr{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type="LineLoop"}},Do=class extends Ln{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new Ee(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},Jf=new De,ph=new Cs,Ca=new Pn,Pa=new A,sc=class extends Tt{constructor(e=new Lt,t=new Do){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Points.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Ca.copy(n.boundingSphere),Ca.applyMatrix4(s),Ca.radius+=r,e.ray.intersectsSphere(Ca)===!1)return;Jf.copy(s).invert(),ph.copy(e.ray).applyMatrix4(Jf);let a=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=n.index,u=n.attributes.position;if(l!==null){let d=Math.max(0,o.start),f=Math.min(l.count,o.start+o.count);for(let m=d,_=f;m<_;m++){let g=l.getX(m);Pa.fromBufferAttribute(u,g),jf(Pa,g,c,s,e,t,this)}}else{let d=Math.max(0,o.start),f=Math.min(u.count,o.start+o.count);for(let m=d,_=f;m<_;m++)Pa.fromBufferAttribute(u,m),jf(Pa,m,c,s,e,t,this)}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){let a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}};function jf(i,e,t,n,s,r,o){let a=ph.distanceSqToPoint(i);if(a<t){let c=new A;ph.closestPointToPoint(i,c),c.applyMatrix4(n);let l=s.ray.origin.distanceTo(c);if(l<s.near||l>s.far)return;r.push({distance:l,distanceToRay:Math.sqrt(a),point:c,index:e,face:null,object:o})}}var Ls=class extends nn{constructor(e,t,n,s,r,o,a,c,l){super(e,t,n,s,r,o,a,c,l),this.isCanvasTexture=!0,this.needsUpdate=!0}},Gn=class{constructor(){this.type="Curve",this.arcLengthDivisions=200}getPoint(){return console.warn("THREE.Curve: .getPoint() not implemented."),null}getPointAt(e,t){let n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],n,s=this.getPoint(0),r=0;t.push(0);for(let o=1;o<=e;o++)n=this.getPoint(o/e),r+=n.distanceTo(s),t.push(r),s=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t){let n=this.getLengths(),s=0,r=n.length,o;t?o=t:o=e*n[r-1];let a=0,c=r-1,l;for(;a<=c;)if(s=Math.floor(a+(c-a)/2),l=n[s]-o,l<0)a=s+1;else if(l>0)c=s-1;else{c=s;break}if(s=c,n[s]===o)return s/(r-1);let h=n[s],d=n[s+1]-h,f=(o-h)/d;return(s+f)/(r-1)}getTangent(e,t){let s=e-1e-4,r=e+1e-4;s<0&&(s=0),r>1&&(r=1);let o=this.getPoint(s),a=this.getPoint(r),c=t||(o.isVector2?new se:new A);return c.copy(a).sub(o).normalize(),c}getTangentAt(e,t){let n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t){let n=new A,s=[],r=[],o=[],a=new A,c=new De;for(let f=0;f<=e;f++){let m=f/e;s[f]=this.getTangentAt(m,new A)}r[0]=new A,o[0]=new A;let l=Number.MAX_VALUE,h=Math.abs(s[0].x),u=Math.abs(s[0].y),d=Math.abs(s[0].z);h<=l&&(l=h,n.set(1,0,0)),u<=l&&(l=u,n.set(0,1,0)),d<=l&&n.set(0,0,1),a.crossVectors(s[0],n).normalize(),r[0].crossVectors(s[0],a),o[0].crossVectors(s[0],r[0]);for(let f=1;f<=e;f++){if(r[f]=r[f-1].clone(),o[f]=o[f-1].clone(),a.crossVectors(s[f-1],s[f]),a.length()>Number.EPSILON){a.normalize();let m=Math.acos($t(s[f-1].dot(s[f]),-1,1));r[f].applyMatrix4(c.makeRotationAxis(a,m))}o[f].crossVectors(s[f],r[f])}if(t===!0){let f=Math.acos($t(r[0].dot(r[e]),-1,1));f/=e,s[0].dot(a.crossVectors(r[0],r[e]))>0&&(f=-f);for(let m=1;m<=e;m++)r[m].applyMatrix4(c.makeRotationAxis(s[m],f*m)),o[m].crossVectors(s[m],r[m])}return{tangents:s,normals:r,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.6,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},No=class extends Gn{constructor(e=0,t=0,n=1,s=1,r=0,o=Math.PI*2,a=!1,c=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=n,this.yRadius=s,this.aStartAngle=r,this.aEndAngle=o,this.aClockwise=a,this.aRotation=c}getPoint(e,t){let n=t||new se,s=Math.PI*2,r=this.aEndAngle-this.aStartAngle,o=Math.abs(r)<Number.EPSILON;for(;r<0;)r+=s;for(;r>s;)r-=s;r<Number.EPSILON&&(o?r=0:r=s),this.aClockwise===!0&&!o&&(r===s?r=-s:r=r-s);let a=this.aStartAngle+e*r,c=this.aX+this.xRadius*Math.cos(a),l=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let h=Math.cos(this.aRotation),u=Math.sin(this.aRotation),d=c-this.aX,f=l-this.aY;c=d*h-f*u+this.aX,l=d*u+f*h+this.aY}return n.set(c,l)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},mh=class extends No{constructor(e,t,n,s,r,o){super(e,t,n,n,s,r,o),this.isArcCurve=!0,this.type="ArcCurve"}};function Vh(){let i=0,e=0,t=0,n=0;function s(r,o,a,c){i=r,e=a,t=-3*r+3*o-2*a-c,n=2*r-2*o+a+c}return{initCatmullRom:function(r,o,a,c,l){s(o,a,l*(a-r),l*(c-o))},initNonuniformCatmullRom:function(r,o,a,c,l,h,u){let d=(o-r)/l-(a-r)/(l+h)+(a-o)/h,f=(a-o)/h-(c-o)/(h+u)+(c-a)/u;d*=h,f*=h,s(o,a,d,f)},calc:function(r){let o=r*r,a=o*r;return i+e*r+t*o+n*a}}}var La=new A,kl=new Vh,zl=new Vh,Hl=new Vh,Uo=class extends Gn{constructor(e=[],t=!1,n="centripetal",s=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=n,this.tension=s}getPoint(e,t=new A){let n=t,s=this.points,r=s.length,o=(r-(this.closed?0:1))*e,a=Math.floor(o),c=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/r)+1)*r:c===0&&a===r-1&&(a=r-2,c=1);let l,h;this.closed||a>0?l=s[(a-1)%r]:(La.subVectors(s[0],s[1]).add(s[0]),l=La);let u=s[a%r],d=s[(a+1)%r];if(this.closed||a+2<r?h=s[(a+2)%r]:(La.subVectors(s[r-1],s[r-2]).add(s[r-1]),h=La),this.curveType==="centripetal"||this.curveType==="chordal"){let f=this.curveType==="chordal"?.5:.25,m=Math.pow(l.distanceToSquared(u),f),_=Math.pow(u.distanceToSquared(d),f),g=Math.pow(d.distanceToSquared(h),f);_<1e-4&&(_=1),m<1e-4&&(m=_),g<1e-4&&(g=_),kl.initNonuniformCatmullRom(l.x,u.x,d.x,h.x,m,_,g),zl.initNonuniformCatmullRom(l.y,u.y,d.y,h.y,m,_,g),Hl.initNonuniformCatmullRom(l.z,u.z,d.z,h.z,m,_,g)}else this.curveType==="catmullrom"&&(kl.initCatmullRom(l.x,u.x,d.x,h.x,this.tension),zl.initCatmullRom(l.y,u.y,d.y,h.y,this.tension),Hl.initCatmullRom(l.z,u.z,d.z,h.z,this.tension));return n.set(kl.calc(c),zl.calc(c),Hl.calc(c)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(s.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let s=this.points[t];e.points.push(s.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(new A().fromArray(s))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function Qf(i,e,t,n,s){let r=(n-e)*.5,o=(s-t)*.5,a=i*i,c=i*a;return(2*t-2*n+r+o)*c+(-3*t+3*n-2*r-o)*a+r*i+t}function SM(i,e){let t=1-i;return t*t*e}function EM(i,e){return 2*(1-i)*i*e}function bM(i,e){return i*i*e}function So(i,e,t,n){return SM(i,e)+EM(i,t)+bM(i,n)}function wM(i,e){let t=1-i;return t*t*t*e}function TM(i,e){let t=1-i;return 3*t*t*i*e}function AM(i,e){return 3*(1-i)*i*i*e}function RM(i,e){return i*i*i*e}function Eo(i,e,t,n,s){return wM(i,e)+TM(i,t)+AM(i,n)+RM(i,s)}var rc=class extends Gn{constructor(e=new se,t=new se,n=new se,s=new se){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=n,this.v3=s}getPoint(e,t=new se){let n=t,s=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(Eo(e,s.x,r.x,o.x,a.x),Eo(e,s.y,r.y,o.y,a.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},gh=class extends Gn{constructor(e=new A,t=new A,n=new A,s=new A){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=n,this.v3=s}getPoint(e,t=new A){let n=t,s=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(Eo(e,s.x,r.x,o.x,a.x),Eo(e,s.y,r.y,o.y,a.y),Eo(e,s.z,r.z,o.z,a.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},oc=class extends Gn{constructor(e=new se,t=new se){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new se){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new se){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},_h=class extends Gn{constructor(e=new A,t=new A){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new A){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new A){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},ac=class extends Gn{constructor(e=new se,t=new se,n=new se){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new se){let n=t,s=this.v0,r=this.v1,o=this.v2;return n.set(So(e,s.x,r.x,o.x),So(e,s.y,r.y,o.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Dr=class extends Gn{constructor(e=new A,t=new A,n=new A){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new A){let n=t,s=this.v0,r=this.v1,o=this.v2;return n.set(So(e,s.x,r.x,o.x),So(e,s.y,r.y,o.y),So(e,s.z,r.z,o.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},cc=class extends Gn{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new se){let n=t,s=this.points,r=(s.length-1)*e,o=Math.floor(r),a=r-o,c=s[o===0?o:o-1],l=s[o],h=s[o>s.length-2?s.length-1:o+1],u=s[o>s.length-3?s.length-1:o+2];return n.set(Qf(a,c.x,l.x,h.x,u.x),Qf(a,c.y,l.y,h.y,u.y)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(s.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let s=this.points[t];e.points.push(s.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(new se().fromArray(s))}return this}},lc=Object.freeze({__proto__:null,ArcCurve:mh,CatmullRomCurve3:Uo,CubicBezierCurve:rc,CubicBezierCurve3:gh,EllipseCurve:No,LineCurve:oc,LineCurve3:_h,QuadraticBezierCurve:ac,QuadraticBezierCurve3:Dr,SplineCurve:cc}),xh=class extends Gn{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),t=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(t)){let n=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new lc[n](t,e))}return this}getPoint(e,t){let n=e*this.getLength(),s=this.getCurveLengths(),r=0;for(;r<s.length;){if(s[r]>=n){let o=s[r]-n,a=this.curves[r],c=a.getLength(),l=c===0?0:1-o/c;return a.getPointAt(l,t)}r++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],t=0;for(let n=0,s=this.curves.length;n<s;n++)t+=this.curves[n].getLength(),e.push(t);return this.cacheLengths=e,e}getSpacedPoints(e=40){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return this.autoClose&&t.push(t[0]),t}getPoints(e=12){let t=[],n;for(let s=0,r=this.curves;s<r.length;s++){let o=r[s],a=o.isEllipseCurve?e*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?e*o.points.length:e,c=o.getPoints(a);for(let l=0;l<c.length;l++){let h=c[l];n&&n.equals(h)||(t.push(h),n=h)}}return this.autoClose&&t.length>1&&!t[t.length-1].equals(t[0])&&t.push(t[0]),t}copy(e){super.copy(e),this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){let s=e.curves[t];this.curves.push(s.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let t=0,n=this.curves.length;t<n;t++){let s=this.curves[t];e.curves.push(s.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){let s=e.curves[t];this.curves.push(new lc[s.type]().fromJSON(s))}return this}},Nr=class extends xh{constructor(e){super(),this.type="Path",this.currentPoint=new se,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let t=1,n=e.length;t<n;t++)this.lineTo(e[t].x,e[t].y);return this}moveTo(e,t){return this.currentPoint.set(e,t),this}lineTo(e,t){let n=new oc(this.currentPoint.clone(),new se(e,t));return this.curves.push(n),this.currentPoint.set(e,t),this}quadraticCurveTo(e,t,n,s){let r=new ac(this.currentPoint.clone(),new se(e,t),new se(n,s));return this.curves.push(r),this.currentPoint.set(n,s),this}bezierCurveTo(e,t,n,s,r,o){let a=new rc(this.currentPoint.clone(),new se(e,t),new se(n,s),new se(r,o));return this.curves.push(a),this.currentPoint.set(r,o),this}splineThru(e){let t=[this.currentPoint.clone()].concat(e),n=new cc(t);return this.curves.push(n),this.currentPoint.copy(e[e.length-1]),this}arc(e,t,n,s,r,o){let a=this.currentPoint.x,c=this.currentPoint.y;return this.absarc(e+a,t+c,n,s,r,o),this}absarc(e,t,n,s,r,o){return this.absellipse(e,t,n,n,s,r,o),this}ellipse(e,t,n,s,r,o,a,c){let l=this.currentPoint.x,h=this.currentPoint.y;return this.absellipse(e+l,t+h,n,s,r,o,a,c),this}absellipse(e,t,n,s,r,o,a,c){let l=new No(e,t,n,s,r,o,a,c);if(this.curves.length>0){let u=l.getPoint(0);u.equals(this.currentPoint)||this.lineTo(u.x,u.y)}this.curves.push(l);let h=l.getPoint(1);return this.currentPoint.copy(h),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}};var jt=class i extends Lt{constructor(e=1,t=1,n=1,s=32,r=1,o=!1,a=0,c=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:s,heightSegments:r,openEnded:o,thetaStart:a,thetaLength:c};let l=this;s=Math.floor(s),r=Math.floor(r);let h=[],u=[],d=[],f=[],m=0,_=[],g=n/2,p=0;v(),o===!1&&(e>0&&x(!0),t>0&&x(!1)),this.setIndex(h),this.setAttribute("position",new lt(u,3)),this.setAttribute("normal",new lt(d,3)),this.setAttribute("uv",new lt(f,2));function v(){let S=new A,P=new A,T=0,R=(t-e)/n;for(let F=0;F<=r;F++){let M=[],w=F/r,U=w*(t-e)+e;for(let q=0;q<=s;q++){let re=q/s,I=re*c+a,O=Math.sin(I),H=Math.cos(I);P.x=U*O,P.y=-w*n+g,P.z=U*H,u.push(P.x,P.y,P.z),S.set(O,R,H).normalize(),d.push(S.x,S.y,S.z),f.push(re,1-w),M.push(m++)}_.push(M)}for(let F=0;F<s;F++)for(let M=0;M<r;M++){let w=_[M][F],U=_[M+1][F],q=_[M+1][F+1],re=_[M][F+1];h.push(w,U,re),h.push(U,q,re),T+=6}l.addGroup(p,T,0),p+=T}function x(S){let P=m,T=new se,R=new A,F=0,M=S===!0?e:t,w=S===!0?1:-1;for(let q=1;q<=s;q++)u.push(0,g*w,0),d.push(0,w,0),f.push(.5,.5),m++;let U=m;for(let q=0;q<=s;q++){let I=q/s*c+a,O=Math.cos(I),H=Math.sin(I);R.x=M*H,R.y=g*w,R.z=M*O,u.push(R.x,R.y,R.z),d.push(0,w,0),T.x=O*.5+.5,T.y=H*.5*w+.5,f.push(T.x,T.y),m++}for(let q=0;q<s;q++){let re=P+q,I=U+q;S===!0?h.push(I,I+1,re):h.push(I+1,I,re),F+=3}l.addGroup(p,F,S===!0?1:2),p+=F}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var Ia=new A,Da=new A,Gl=new A,Na=new bs,hc=class extends Lt{constructor(e=null,t=1){if(super(),this.type="EdgesGeometry",this.parameters={geometry:e,thresholdAngle:t},e!==null){let s=Math.pow(10,4),r=Math.cos(vr*t),o=e.getIndex(),a=e.getAttribute("position"),c=o?o.count:a.count,l=[0,0,0],h=["a","b","c"],u=new Array(3),d={},f=[];for(let m=0;m<c;m+=3){o?(l[0]=o.getX(m),l[1]=o.getX(m+1),l[2]=o.getX(m+2)):(l[0]=m,l[1]=m+1,l[2]=m+2);let{a:_,b:g,c:p}=Na;if(_.fromBufferAttribute(a,l[0]),g.fromBufferAttribute(a,l[1]),p.fromBufferAttribute(a,l[2]),Na.getNormal(Gl),u[0]=`${Math.round(_.x*s)},${Math.round(_.y*s)},${Math.round(_.z*s)}`,u[1]=`${Math.round(g.x*s)},${Math.round(g.y*s)},${Math.round(g.z*s)}`,u[2]=`${Math.round(p.x*s)},${Math.round(p.y*s)},${Math.round(p.z*s)}`,!(u[0]===u[1]||u[1]===u[2]||u[2]===u[0]))for(let v=0;v<3;v++){let x=(v+1)%3,S=u[v],P=u[x],T=Na[h[v]],R=Na[h[x]],F=`${S}_${P}`,M=`${P}_${S}`;M in d&&d[M]?(Gl.dot(d[M].normal)<=r&&(f.push(T.x,T.y,T.z),f.push(R.x,R.y,R.z)),d[M]=null):F in d||(d[F]={index0:l[v],index1:l[x],normal:Gl.clone()})}}for(let m in d)if(d[m]){let{index0:_,index1:g}=d[m];Ia.fromBufferAttribute(a,_),Da.fromBufferAttribute(a,g),f.push(Ia.x,Ia.y,Ia.z),f.push(Da.x,Da.y,Da.z)}this.setAttribute("position",new lt(f,3))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}},Is=class extends Nr{constructor(e){super(e),this.uuid=zn(),this.type="Shape",this.holes=[]}getPointsHoles(e){let t=[];for(let n=0,s=this.holes.length;n<s;n++)t[n]=this.holes[n].getPoints(e);return t}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let t=0,n=e.holes.length;t<n;t++){let s=e.holes[t];this.holes.push(s.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let t=0,n=this.holes.length;t<n;t++){let s=this.holes[t];e.holes.push(s.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let t=0,n=e.holes.length;t<n;t++){let s=e.holes[t];this.holes.push(new Nr().fromJSON(s))}return this}},CM={triangulate:function(i,e,t=2){let n=e&&e.length,s=n?e[0]*t:i.length,r=Ip(i,0,s,t,!0),o=[];if(!r||r.next===r.prev)return o;let a,c,l,h,u,d,f;if(n&&(r=NM(i,e,r,t)),i.length>80*t){a=l=i[0],c=h=i[1];for(let m=t;m<s;m+=t)u=i[m],d=i[m+1],u<a&&(a=u),d<c&&(c=d),u>l&&(l=u),d>h&&(h=d);f=Math.max(l-a,h-c),f=f!==0?32767/f:0}return Oo(r,o,t,a,c,f,0),o}};function Ip(i,e,t,n,s){let r,o;if(s===XM(i,e,t,n)>0)for(r=e;r<t;r+=n)o=ep(r,i[r],i[r+1],o);else for(r=t-n;r>=e;r-=n)o=ep(r,i[r],i[r+1],o);return o&&Pc(o,o.next)&&(Bo(o),o=o.next),o}function Ds(i,e){if(!i)return i;e||(e=i);let t=i,n;do if(n=!1,!t.steiner&&(Pc(t,t.next)||Pt(t.prev,t,t.next)===0)){if(Bo(t),t=e=t.prev,t===t.next)break;n=!0}else t=t.next;while(n||t!==e);return e}function Oo(i,e,t,n,s,r,o){if(!i)return;!o&&r&&kM(i,n,s,r);let a=i,c,l;for(;i.prev!==i.next;){if(c=i.prev,l=i.next,r?LM(i,n,s,r):PM(i)){e.push(c.i/t|0),e.push(i.i/t|0),e.push(l.i/t|0),Bo(i),i=l.next,a=l.next;continue}if(i=l,i===a){o?o===1?(i=IM(Ds(i),e,t),Oo(i,e,t,n,s,r,2)):o===2&&DM(i,e,t,n,s,r):Oo(Ds(i),e,t,n,s,r,1);break}}}function PM(i){let e=i.prev,t=i,n=i.next;if(Pt(e,t,n)>=0)return!1;let s=e.x,r=t.x,o=n.x,a=e.y,c=t.y,l=n.y,h=s<r?s<o?s:o:r<o?r:o,u=a<c?a<l?a:l:c<l?c:l,d=s>r?s>o?s:o:r>o?r:o,f=a>c?a>l?a:l:c>l?c:l,m=n.next;for(;m!==e;){if(m.x>=h&&m.x<=d&&m.y>=u&&m.y<=f&&xr(s,a,r,c,o,l,m.x,m.y)&&Pt(m.prev,m,m.next)>=0)return!1;m=m.next}return!0}function LM(i,e,t,n){let s=i.prev,r=i,o=i.next;if(Pt(s,r,o)>=0)return!1;let a=s.x,c=r.x,l=o.x,h=s.y,u=r.y,d=o.y,f=a<c?a<l?a:l:c<l?c:l,m=h<u?h<d?h:d:u<d?u:d,_=a>c?a>l?a:l:c>l?c:l,g=h>u?h>d?h:d:u>d?u:d,p=yh(f,m,e,t,n),v=yh(_,g,e,t,n),x=i.prevZ,S=i.nextZ;for(;x&&x.z>=p&&S&&S.z<=v;){if(x.x>=f&&x.x<=_&&x.y>=m&&x.y<=g&&x!==s&&x!==o&&xr(a,h,c,u,l,d,x.x,x.y)&&Pt(x.prev,x,x.next)>=0||(x=x.prevZ,S.x>=f&&S.x<=_&&S.y>=m&&S.y<=g&&S!==s&&S!==o&&xr(a,h,c,u,l,d,S.x,S.y)&&Pt(S.prev,S,S.next)>=0))return!1;S=S.nextZ}for(;x&&x.z>=p;){if(x.x>=f&&x.x<=_&&x.y>=m&&x.y<=g&&x!==s&&x!==o&&xr(a,h,c,u,l,d,x.x,x.y)&&Pt(x.prev,x,x.next)>=0)return!1;x=x.prevZ}for(;S&&S.z<=v;){if(S.x>=f&&S.x<=_&&S.y>=m&&S.y<=g&&S!==s&&S!==o&&xr(a,h,c,u,l,d,S.x,S.y)&&Pt(S.prev,S,S.next)>=0)return!1;S=S.nextZ}return!0}function IM(i,e,t){let n=i;do{let s=n.prev,r=n.next.next;!Pc(s,r)&&Dp(s,n,n.next,r)&&Fo(s,r)&&Fo(r,s)&&(e.push(s.i/t|0),e.push(n.i/t|0),e.push(r.i/t|0),Bo(n),Bo(n.next),n=i=r),n=n.next}while(n!==i);return Ds(n)}function DM(i,e,t,n,s,r){let o=i;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&GM(o,a)){let c=Np(o,a);o=Ds(o,o.next),c=Ds(c,c.next),Oo(o,e,t,n,s,r,0),Oo(c,e,t,n,s,r,0);return}a=a.next}o=o.next}while(o!==i)}function NM(i,e,t,n){let s=[],r,o,a,c,l;for(r=0,o=e.length;r<o;r++)a=e[r]*n,c=r<o-1?e[r+1]*n:i.length,l=Ip(i,a,c,n,!1),l===l.next&&(l.steiner=!0),s.push(HM(l));for(s.sort(UM),r=0;r<s.length;r++)t=OM(s[r],t);return t}function UM(i,e){return i.x-e.x}function OM(i,e){let t=FM(i,e);if(!t)return e;let n=Np(t,i);return Ds(n,n.next),Ds(t,t.next)}function FM(i,e){let t=e,n=-1/0,s,r=i.x,o=i.y;do{if(o<=t.y&&o>=t.next.y&&t.next.y!==t.y){let d=t.x+(o-t.y)*(t.next.x-t.x)/(t.next.y-t.y);if(d<=r&&d>n&&(n=d,s=t.x<t.next.x?t:t.next,d===r))return s}t=t.next}while(t!==e);if(!s)return null;let a=s,c=s.x,l=s.y,h=1/0,u;t=s;do r>=t.x&&t.x>=c&&r!==t.x&&xr(o<l?r:n,o,c,l,o<l?n:r,o,t.x,t.y)&&(u=Math.abs(o-t.y)/(r-t.x),Fo(t,i)&&(u<h||u===h&&(t.x>s.x||t.x===s.x&&BM(s,t)))&&(s=t,h=u)),t=t.next;while(t!==a);return s}function BM(i,e){return Pt(i.prev,i,e.prev)<0&&Pt(e.next,i,i.next)<0}function kM(i,e,t,n){let s=i;do s.z===0&&(s.z=yh(s.x,s.y,e,t,n)),s.prevZ=s.prev,s.nextZ=s.next,s=s.next;while(s!==i);s.prevZ.nextZ=null,s.prevZ=null,zM(s)}function zM(i){let e,t,n,s,r,o,a,c,l=1;do{for(t=i,i=null,r=null,o=0;t;){for(o++,n=t,a=0,e=0;e<l&&(a++,n=n.nextZ,!!n);e++);for(c=l;a>0||c>0&&n;)a!==0&&(c===0||!n||t.z<=n.z)?(s=t,t=t.nextZ,a--):(s=n,n=n.nextZ,c--),r?r.nextZ=s:i=s,s.prevZ=r,r=s;t=n}r.nextZ=null,l*=2}while(o>1);return i}function yh(i,e,t,n,s){return i=(i-t)*s|0,e=(e-n)*s|0,i=(i|i<<8)&16711935,i=(i|i<<4)&252645135,i=(i|i<<2)&858993459,i=(i|i<<1)&1431655765,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,i|e<<1}function HM(i){let e=i,t=i;do(e.x<t.x||e.x===t.x&&e.y<t.y)&&(t=e),e=e.next;while(e!==i);return t}function xr(i,e,t,n,s,r,o,a){return(s-o)*(e-a)>=(i-o)*(r-a)&&(i-o)*(n-a)>=(t-o)*(e-a)&&(t-o)*(r-a)>=(s-o)*(n-a)}function GM(i,e){return i.next.i!==e.i&&i.prev.i!==e.i&&!VM(i,e)&&(Fo(i,e)&&Fo(e,i)&&WM(i,e)&&(Pt(i.prev,i,e.prev)||Pt(i,e.prev,e))||Pc(i,e)&&Pt(i.prev,i,i.next)>0&&Pt(e.prev,e,e.next)>0)}function Pt(i,e,t){return(e.y-i.y)*(t.x-e.x)-(e.x-i.x)*(t.y-e.y)}function Pc(i,e){return i.x===e.x&&i.y===e.y}function Dp(i,e,t,n){let s=Oa(Pt(i,e,t)),r=Oa(Pt(i,e,n)),o=Oa(Pt(t,n,i)),a=Oa(Pt(t,n,e));return!!(s!==r&&o!==a||s===0&&Ua(i,t,e)||r===0&&Ua(i,n,e)||o===0&&Ua(t,i,n)||a===0&&Ua(t,e,n))}function Ua(i,e,t){return e.x<=Math.max(i.x,t.x)&&e.x>=Math.min(i.x,t.x)&&e.y<=Math.max(i.y,t.y)&&e.y>=Math.min(i.y,t.y)}function Oa(i){return i>0?1:i<0?-1:0}function VM(i,e){let t=i;do{if(t.i!==i.i&&t.next.i!==i.i&&t.i!==e.i&&t.next.i!==e.i&&Dp(t,t.next,i,e))return!0;t=t.next}while(t!==i);return!1}function Fo(i,e){return Pt(i.prev,i,i.next)<0?Pt(i,e,i.next)>=0&&Pt(i,i.prev,e)>=0:Pt(i,e,i.prev)<0||Pt(i,i.next,e)<0}function WM(i,e){let t=i,n=!1,s=(i.x+e.x)/2,r=(i.y+e.y)/2;do t.y>r!=t.next.y>r&&t.next.y!==t.y&&s<(t.next.x-t.x)*(r-t.y)/(t.next.y-t.y)+t.x&&(n=!n),t=t.next;while(t!==i);return n}function Np(i,e){let t=new vh(i.i,i.x,i.y),n=new vh(e.i,e.x,e.y),s=i.next,r=e.prev;return i.next=e,e.prev=i,t.next=s,s.prev=t,n.next=t,t.prev=n,r.next=n,n.prev=r,n}function ep(i,e,t,n){let s=new vh(i,e,t);return n?(s.next=n.next,s.prev=n,n.next.prev=s,n.next=s):(s.prev=s,s.next=s),s}function Bo(i){i.next.prev=i.prev,i.prev.next=i.next,i.prevZ&&(i.prevZ.nextZ=i.nextZ),i.nextZ&&(i.nextZ.prevZ=i.prevZ)}function vh(i,e,t){this.i=i,this.x=e,this.y=t,this.prev=null,this.next=null,this.z=0,this.prevZ=null,this.nextZ=null,this.steiner=!1}function XM(i,e,t,n){let s=0;for(let r=e,o=t-n;r<t;r+=n)s+=(i[o]-i[r])*(i[r+1]+i[o+1]),o=r;return s}var Zi=class i{static area(e){let t=e.length,n=0;for(let s=t-1,r=0;r<t;s=r++)n+=e[s].x*e[r].y-e[r].x*e[s].y;return n*.5}static isClockWise(e){return i.area(e)<0}static triangulateShape(e,t){let n=[],s=[],r=[];tp(e),np(n,e);let o=e.length;t.forEach(tp);for(let c=0;c<t.length;c++)s.push(o),o+=t[c].length,np(n,t[c]);let a=CM.triangulate(n,s);for(let c=0;c<a.length;c+=3)r.push(a.slice(c,c+3));return r}};function tp(i){let e=i.length;e>2&&i[e-1].equals(i[0])&&i.pop()}function np(i,e){for(let t=0;t<e.length;t++)i.push(e[t].x),i.push(e[t].y)}var uc=class i extends Lt{constructor(e=new Is([new se(.5,.5),new se(-.5,.5),new se(-.5,-.5),new se(.5,-.5)]),t={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:e,options:t},e=Array.isArray(e)?e:[e];let n=this,s=[],r=[];for(let a=0,c=e.length;a<c;a++){let l=e[a];o(l)}this.setAttribute("position",new lt(s,3)),this.setAttribute("uv",new lt(r,2)),this.computeVertexNormals();function o(a){let c=[],l=t.curveSegments!==void 0?t.curveSegments:12,h=t.steps!==void 0?t.steps:1,u=t.depth!==void 0?t.depth:1,d=t.bevelEnabled!==void 0?t.bevelEnabled:!0,f=t.bevelThickness!==void 0?t.bevelThickness:.2,m=t.bevelSize!==void 0?t.bevelSize:f-.1,_=t.bevelOffset!==void 0?t.bevelOffset:0,g=t.bevelSegments!==void 0?t.bevelSegments:3,p=t.extrudePath,v=t.UVGenerator!==void 0?t.UVGenerator:qM,x,S=!1,P,T,R,F;p&&(x=p.getSpacedPoints(h),S=!0,d=!1,P=p.computeFrenetFrames(h,!1),T=new A,R=new A,F=new A),d||(g=0,f=0,m=0,_=0);let M=a.extractPoints(l),w=M.shape,U=M.holes;if(!Zi.isClockWise(w)){w=w.reverse();for(let C=0,ce=U.length;C<ce;C++){let X=U[C];Zi.isClockWise(X)&&(U[C]=X.reverse())}}let re=Zi.triangulateShape(w,U),I=w;for(let C=0,ce=U.length;C<ce;C++){let X=U[C];w=w.concat(X)}function O(C,ce,X){return ce||console.error("THREE.ExtrudeGeometry: vec does not exist"),C.clone().addScaledVector(ce,X)}let H=w.length,K=re.length;function Y(C,ce,X){let oe,W,Le,_e=C.x-ce.x,E=C.y-ce.y,y=X.x-C.x,N=X.y-C.y,ne=_e*_e+E*E,j=_e*N-E*y;if(Math.abs(j)>Number.EPSILON){let $=Math.sqrt(ne),we=Math.sqrt(y*y+N*N),de=ce.x-E/$,ve=ce.y+_e/$,Ne=X.x-N/we,Xe=X.y+y/we,Q=((Ne-de)*N-(Xe-ve)*y)/(_e*N-E*y);oe=de+_e*Q-C.x,W=ve+E*Q-C.y;let dt=oe*oe+W*W;if(dt<=2)return new se(oe,W);Le=Math.sqrt(dt/2)}else{let $=!1;_e>Number.EPSILON?y>Number.EPSILON&&($=!0):_e<-Number.EPSILON?y<-Number.EPSILON&&($=!0):Math.sign(E)===Math.sign(N)&&($=!0),$?(oe=-E,W=_e,Le=Math.sqrt(ne)):(oe=_e,W=E,Le=Math.sqrt(ne/2))}return new se(oe/Le,W/Le)}let V=[];for(let C=0,ce=I.length,X=ce-1,oe=C+1;C<ce;C++,X++,oe++)X===ce&&(X=0),oe===ce&&(oe=0),V[C]=Y(I[C],I[X],I[oe]);let ee=[],te,me=V.concat();for(let C=0,ce=U.length;C<ce;C++){let X=U[C];te=[];for(let oe=0,W=X.length,Le=W-1,_e=oe+1;oe<W;oe++,Le++,_e++)Le===W&&(Le=0),_e===W&&(_e=0),te[oe]=Y(X[oe],X[Le],X[_e]);ee.push(te),me=me.concat(te)}for(let C=0;C<g;C++){let ce=C/g,X=f*Math.cos(ce*Math.PI/2),oe=m*Math.sin(ce*Math.PI/2)+_;for(let W=0,Le=I.length;W<Le;W++){let _e=O(I[W],V[W],oe);ye(_e.x,_e.y,-X)}for(let W=0,Le=U.length;W<Le;W++){let _e=U[W];te=ee[W];for(let E=0,y=_e.length;E<y;E++){let N=O(_e[E],te[E],oe);ye(N.x,N.y,-X)}}}let G=m+_;for(let C=0;C<H;C++){let ce=d?O(w[C],me[C],G):w[C];S?(R.copy(P.normals[0]).multiplyScalar(ce.x),T.copy(P.binormals[0]).multiplyScalar(ce.y),F.copy(x[0]).add(R).add(T),ye(F.x,F.y,F.z)):ye(ce.x,ce.y,0)}for(let C=1;C<=h;C++)for(let ce=0;ce<H;ce++){let X=d?O(w[ce],me[ce],G):w[ce];S?(R.copy(P.normals[C]).multiplyScalar(X.x),T.copy(P.binormals[C]).multiplyScalar(X.y),F.copy(x[C]).add(R).add(T),ye(F.x,F.y,F.z)):ye(X.x,X.y,u/h*C)}for(let C=g-1;C>=0;C--){let ce=C/g,X=f*Math.cos(ce*Math.PI/2),oe=m*Math.sin(ce*Math.PI/2)+_;for(let W=0,Le=I.length;W<Le;W++){let _e=O(I[W],V[W],oe);ye(_e.x,_e.y,u+X)}for(let W=0,Le=U.length;W<Le;W++){let _e=U[W];te=ee[W];for(let E=0,y=_e.length;E<y;E++){let N=O(_e[E],te[E],oe);S?ye(N.x,N.y+x[h-1].y,x[h-1].x+X):ye(N.x,N.y,u+X)}}}J(),ge();function J(){let C=s.length/3;if(d){let ce=0,X=H*ce;for(let oe=0;oe<K;oe++){let W=re[oe];Fe(W[2]+X,W[1]+X,W[0]+X)}ce=h+g*2,X=H*ce;for(let oe=0;oe<K;oe++){let W=re[oe];Fe(W[0]+X,W[1]+X,W[2]+X)}}else{for(let ce=0;ce<K;ce++){let X=re[ce];Fe(X[2],X[1],X[0])}for(let ce=0;ce<K;ce++){let X=re[ce];Fe(X[0]+H*h,X[1]+H*h,X[2]+H*h)}}n.addGroup(C,s.length/3-C,0)}function ge(){let C=s.length/3,ce=0;Ae(I,ce),ce+=I.length;for(let X=0,oe=U.length;X<oe;X++){let W=U[X];Ae(W,ce),ce+=W.length}n.addGroup(C,s.length/3-C,1)}function Ae(C,ce){let X=C.length;for(;--X>=0;){let oe=X,W=X-1;W<0&&(W=C.length-1);for(let Le=0,_e=h+g*2;Le<_e;Le++){let E=H*Le,y=H*(Le+1),N=ce+oe+E,ne=ce+W+E,j=ce+W+y,$=ce+oe+y;Ve(N,ne,j,$)}}}function ye(C,ce,X){c.push(C),c.push(ce),c.push(X)}function Fe(C,ce,X){Re(C),Re(ce),Re(X);let oe=s.length/3,W=v.generateTopUV(n,s,oe-3,oe-2,oe-1);He(W[0]),He(W[1]),He(W[2])}function Ve(C,ce,X,oe){Re(C),Re(ce),Re(oe),Re(ce),Re(X),Re(oe);let W=s.length/3,Le=v.generateSideWallUV(n,s,W-6,W-3,W-2,W-1);He(Le[0]),He(Le[1]),He(Le[3]),He(Le[1]),He(Le[2]),He(Le[3])}function Re(C){s.push(c[C*3+0]),s.push(c[C*3+1]),s.push(c[C*3+2])}function He(C){r.push(C.x),r.push(C.y)}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),t=this.parameters.shapes,n=this.parameters.options;return YM(t,n,e)}static fromJSON(e,t){let n=[];for(let r=0,o=e.shapes.length;r<o;r++){let a=t[e.shapes[r]];n.push(a)}let s=e.options.extrudePath;return s!==void 0&&(e.options.extrudePath=new lc[s.type]().fromJSON(s)),new i(n,e.options)}},qM={generateTopUV:function(i,e,t,n,s){let r=e[t*3],o=e[t*3+1],a=e[n*3],c=e[n*3+1],l=e[s*3],h=e[s*3+1];return[new se(r,o),new se(a,c),new se(l,h)]},generateSideWallUV:function(i,e,t,n,s,r){let o=e[t*3],a=e[t*3+1],c=e[t*3+2],l=e[n*3],h=e[n*3+1],u=e[n*3+2],d=e[s*3],f=e[s*3+1],m=e[s*3+2],_=e[r*3],g=e[r*3+1],p=e[r*3+2];return Math.abs(a-h)<Math.abs(o-l)?[new se(o,1-c),new se(l,1-u),new se(d,1-m),new se(_,1-p)]:[new se(a,1-c),new se(h,1-u),new se(f,1-m),new se(g,1-p)]}};function YM(i,e,t){if(t.shapes=[],Array.isArray(i))for(let n=0,s=i.length;n<s;n++){let r=i[n];t.shapes.push(r.uuid)}else t.shapes.push(i.uuid);return t.options=Object.assign({},e),e.extrudePath!==void 0&&(t.options.extrudePath=e.extrudePath.toJSON()),t}var dc=class i extends Lt{constructor(e=.5,t=1,n=32,s=1,r=0,o=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:e,outerRadius:t,thetaSegments:n,phiSegments:s,thetaStart:r,thetaLength:o},n=Math.max(3,n),s=Math.max(1,s);let a=[],c=[],l=[],h=[],u=e,d=(t-e)/s,f=new A,m=new se;for(let _=0;_<=s;_++){for(let g=0;g<=n;g++){let p=r+g/n*o;f.x=u*Math.cos(p),f.y=u*Math.sin(p),c.push(f.x,f.y,f.z),l.push(0,0,1),m.x=(f.x/t+1)/2,m.y=(f.y/t+1)/2,h.push(m.x,m.y)}u+=d}for(let _=0;_<s;_++){let g=_*(n+1);for(let p=0;p<n;p++){let v=p+g,x=v,S=v+n+1,P=v+n+2,T=v+1;a.push(x,S,T),a.push(S,P,T)}}this.setIndex(a),this.setAttribute("position",new lt(c,3)),this.setAttribute("normal",new lt(l,3)),this.setAttribute("uv",new lt(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.innerRadius,e.outerRadius,e.thetaSegments,e.phiSegments,e.thetaStart,e.thetaLength)}},fc=class i extends Lt{constructor(e=new Is([new se(0,.5),new se(-.5,-.5),new se(.5,-.5)]),t=12){super(),this.type="ShapeGeometry",this.parameters={shapes:e,curveSegments:t};let n=[],s=[],r=[],o=[],a=0,c=0;if(Array.isArray(e)===!1)l(e);else for(let h=0;h<e.length;h++)l(e[h]),this.addGroup(a,c,h),a+=c,c=0;this.setIndex(n),this.setAttribute("position",new lt(s,3)),this.setAttribute("normal",new lt(r,3)),this.setAttribute("uv",new lt(o,2));function l(h){let u=s.length/3,d=h.extractPoints(t),f=d.shape,m=d.holes;Zi.isClockWise(f)===!1&&(f=f.reverse());for(let g=0,p=m.length;g<p;g++){let v=m[g];Zi.isClockWise(v)===!0&&(m[g]=v.reverse())}let _=Zi.triangulateShape(f,m);for(let g=0,p=m.length;g<p;g++){let v=m[g];f=f.concat(v)}for(let g=0,p=f.length;g<p;g++){let v=f[g];s.push(v.x,v.y,0),r.push(0,0,1),o.push(v.x,v.y)}for(let g=0,p=_.length;g<p;g++){let v=_[g],x=v[0]+u,S=v[1]+u,P=v[2]+u;n.push(x,S,P),c+=3}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),t=this.parameters.shapes;return ZM(t,e)}static fromJSON(e,t){let n=[];for(let s=0,r=e.shapes.length;s<r;s++){let o=t[e.shapes[s]];n.push(o)}return new i(n,e.curveSegments)}};function ZM(i,e){if(e.shapes=[],Array.isArray(i))for(let t=0,n=i.length;t<n;t++){let s=i[t];e.shapes.push(s.uuid)}else e.shapes.push(i.uuid);return e}var pc=class i extends Lt{constructor(e=1,t=32,n=16,s=0,r=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:s,phiLength:r,thetaStart:o,thetaLength:a},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let c=Math.min(o+a,Math.PI),l=0,h=[],u=new A,d=new A,f=[],m=[],_=[],g=[];for(let p=0;p<=n;p++){let v=[],x=p/n,S=0;p===0&&o===0?S=.5/t:p===n&&c===Math.PI&&(S=-.5/t);for(let P=0;P<=t;P++){let T=P/t;u.x=-e*Math.cos(s+T*r)*Math.sin(o+x*a),u.y=e*Math.cos(o+x*a),u.z=e*Math.sin(s+T*r)*Math.sin(o+x*a),m.push(u.x,u.y,u.z),d.copy(u).normalize(),_.push(d.x,d.y,d.z),g.push(T+S,1-x),v.push(l++)}h.push(v)}for(let p=0;p<n;p++)for(let v=0;v<t;v++){let x=h[p][v+1],S=h[p][v],P=h[p+1][v],T=h[p+1][v+1];(p!==0||o>0)&&f.push(x,S,T),(p!==n-1||c<Math.PI)&&f.push(S,P,T)}this.setIndex(f),this.setAttribute("position",new lt(m,3)),this.setAttribute("normal",new lt(_,3)),this.setAttribute("uv",new lt(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var mc=class i extends Lt{constructor(e=1,t=.4,n=12,s=48,r=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:t,radialSegments:n,tubularSegments:s,arc:r},n=Math.floor(n),s=Math.floor(s);let o=[],a=[],c=[],l=[],h=new A,u=new A,d=new A;for(let f=0;f<=n;f++)for(let m=0;m<=s;m++){let _=m/s*r,g=f/n*Math.PI*2;u.x=(e+t*Math.cos(g))*Math.cos(_),u.y=(e+t*Math.cos(g))*Math.sin(_),u.z=t*Math.sin(g),a.push(u.x,u.y,u.z),h.x=e*Math.cos(_),h.y=e*Math.sin(_),d.subVectors(u,h).normalize(),c.push(d.x,d.y,d.z),l.push(m/s),l.push(f/n)}for(let f=1;f<=n;f++)for(let m=1;m<=s;m++){let _=(s+1)*f+m-1,g=(s+1)*(f-1)+m-1,p=(s+1)*(f-1)+m,v=(s+1)*f+m;o.push(_,g,v),o.push(g,p,v)}this.setIndex(o),this.setAttribute("position",new lt(a,3)),this.setAttribute("normal",new lt(c,3)),this.setAttribute("uv",new lt(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}};var gc=class i extends Lt{constructor(e=new Dr(new A(-1,-1,0),new A(-1,1,0),new A(1,1,0)),t=64,n=1,s=8,r=!1){super(),this.type="TubeGeometry",this.parameters={path:e,tubularSegments:t,radius:n,radialSegments:s,closed:r};let o=e.computeFrenetFrames(t,r);this.tangents=o.tangents,this.normals=o.normals,this.binormals=o.binormals;let a=new A,c=new A,l=new se,h=new A,u=[],d=[],f=[],m=[];_(),this.setIndex(m),this.setAttribute("position",new lt(u,3)),this.setAttribute("normal",new lt(d,3)),this.setAttribute("uv",new lt(f,2));function _(){for(let x=0;x<t;x++)g(x);g(r===!1?t:0),v(),p()}function g(x){h=e.getPointAt(x/t,h);let S=o.normals[x],P=o.binormals[x];for(let T=0;T<=s;T++){let R=T/s*Math.PI*2,F=Math.sin(R),M=-Math.cos(R);c.x=M*S.x+F*P.x,c.y=M*S.y+F*P.y,c.z=M*S.z+F*P.z,c.normalize(),d.push(c.x,c.y,c.z),a.x=h.x+n*c.x,a.y=h.y+n*c.y,a.z=h.z+n*c.z,u.push(a.x,a.y,a.z)}}function p(){for(let x=1;x<=t;x++)for(let S=1;S<=s;S++){let P=(s+1)*(x-1)+(S-1),T=(s+1)*x+(S-1),R=(s+1)*x+S,F=(s+1)*(x-1)+S;m.push(P,T,F),m.push(T,R,F)}}function v(){for(let x=0;x<=t;x++)for(let S=0;S<=s;S++)l.x=x/t,l.y=S/s,f.push(l.x,l.y)}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON();return e.path=this.parameters.path.toJSON(),e}static fromJSON(e){return new i(new lc[e.path.type]().fromJSON(e.path),e.tubularSegments,e.radius,e.radialSegments,e.closed)}};var ht=class extends Ln{constructor(e){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.type="MeshStandardMaterial",this.color=new Ee(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ee(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Mp,this.normalScale=new se(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},Vn=class extends ht{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new se(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return $t(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Ee(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Ee(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Ee(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}};function Fa(i,e,t){return!i||!t&&i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}function KM(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}function $M(i){function e(s,r){return i[s]-i[r]}let t=i.length,n=new Array(t);for(let s=0;s!==t;++s)n[s]=s;return n.sort(e),n}function ip(i,e,t){let n=i.length,s=new i.constructor(n);for(let r=0,o=0;o!==n;++r){let a=t[r]*e;for(let c=0;c!==e;++c)s[o++]=i[a+c]}return s}function Up(i,e,t,n){let s=1,r=i[0];for(;r!==void 0&&r[n]===void 0;)r=i[s++];if(r===void 0)return;let o=r[n];if(o!==void 0)if(Array.isArray(o))do o=r[n],o!==void 0&&(e.push(r.time),t.push.apply(t,o)),r=i[s++];while(r!==void 0);else if(o.toArray!==void 0)do o=r[n],o!==void 0&&(e.push(r.time),o.toArray(t,t.length)),r=i[s++];while(r!==void 0);else do o=r[n],o!==void 0&&(e.push(r.time),t.push(o)),r=i[s++];while(r!==void 0)}var ji=class{constructor(e,t,n,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,s=t[n],r=t[n-1];e:{t:{let o;n:{i:if(!(e<s)){for(let a=n+2;;){if(s===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(r=s,s=t[++n],e<s)break t}o=t.length;break n}if(!(e>=r)){let a=t[1];e<a&&(n=2,r=a);for(let c=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===c)break;if(s=r,r=t[--n-1],e>=r)break t}o=n,n=0;break n}break e}for(;n<o;){let a=n+o>>>1;e<t[a]?o=a:n=a+1}if(s=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s;for(let o=0;o!==s;++o)t[o]=n[r+o];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Mh=class extends ji{constructor(e,t,n,s){super(e,t,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:pr,endingEnd:pr}}intervalChanged_(e,t,n){let s=this.parameterPositions,r=e-2,o=e+1,a=s[r],c=s[o];if(a===void 0)switch(this.getSettings_().endingStart){case mr:r=e,a=2*t-n;break;case za:r=s.length-2,a=t+s[r]-s[r+1];break;default:r=e,a=n}if(c===void 0)switch(this.getSettings_().endingEnd){case mr:o=e,c=2*n-t;break;case za:o=1,c=n+s[1]-s[0];break;default:o=e-1,c=t}let l=(n-t)*.5,h=this.valueSize;this._weightPrev=l/(t-a),this._weightNext=l/(c-n),this._offsetPrev=r*h,this._offsetNext=o*h}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=e*a,l=c-a,h=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,m=(n-t)/(s-t),_=m*m,g=_*m,p=-d*g+2*d*_-d*m,v=(1+d)*g+(-1.5-2*d)*_+(-.5+d)*m+1,x=(-1-f)*g+(1.5+f)*_+.5*m,S=f*g-f*_;for(let P=0;P!==a;++P)r[P]=p*o[h+P]+v*o[l+P]+x*o[c+P]+S*o[u+P];return r}},_c=class extends ji{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=e*a,l=c-a,h=(n-t)/(s-t),u=1-h;for(let d=0;d!==a;++d)r[d]=o[l+d]*u+o[c+d]*h;return r}},Sh=class extends ji{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e){return this.copySampleValue_(e-1)}},Wn=class{constructor(e,t,n,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Fa(t,this.TimeBufferType),this.values=Fa(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Fa(e.times,Array),values:Fa(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(n.interpolation=s)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Sh(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new _c(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Mh(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case Tr:t=this.InterpolantFactoryMethodDiscrete;break;case Rs:t=this.InterpolantFactoryMethodLinear;break;case fl:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Tr;case this.InterpolantFactoryMethodLinear:return Rs;case this.InterpolantFactoryMethodSmooth:return fl}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]*=e}return this}trim(e,t){let n=this.times,s=n.length,r=0,o=s-1;for(;r!==s&&n[r]<e;)++r;for(;o!==-1&&n[o]>t;)--o;if(++o,r!==0||o!==s){r>=o&&(o=Math.max(o,1),r=o-1);let a=this.getValueSize();this.times=n.slice(r,o),this.values=this.values.slice(r*a,o*a)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,s=this.values,r=n.length;r===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==r;a++){let c=n[a];if(typeof c=="number"&&isNaN(c)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,a,c),e=!1;break}if(o!==null&&o>c){console.error("THREE.KeyframeTrack: Out of order keys.",this,a,c,o),e=!1;break}o=c}if(s!==void 0&&KM(s))for(let a=0,c=s.length;a!==c;++a){let l=s[a];if(isNaN(l)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,a,l),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===fl,r=e.length-1,o=1;for(let a=1;a<r;++a){let c=!1,l=e[a],h=e[a+1];if(l!==h&&(a!==1||l!==e[0]))if(s)c=!0;else{let u=a*n,d=u-n,f=u+n;for(let m=0;m!==n;++m){let _=t[u+m];if(_!==t[d+m]||_!==t[f+m]){c=!0;break}}}if(c){if(a!==o){e[o]=e[a];let u=a*n,d=o*n;for(let f=0;f!==n;++f)t[d+f]=t[u+f]}++o}}if(r>0){e[o]=e[r];for(let a=r*n,c=o*n,l=0;l!==n;++l)t[c+l]=t[a+l];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=t.slice(0,o*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,s=new n(this.name,e,t);return s.createInterpolant=this.createInterpolant,s}};Wn.prototype.TimeBufferType=Float32Array;Wn.prototype.ValueBufferType=Float32Array;Wn.prototype.DefaultInterpolation=Rs;var Qi=class extends Wn{};Qi.prototype.ValueTypeName="bool";Qi.prototype.ValueBufferType=Array;Qi.prototype.DefaultInterpolation=Tr;Qi.prototype.InterpolantFactoryMethodLinear=void 0;Qi.prototype.InterpolantFactoryMethodSmooth=void 0;var xc=class extends Wn{};xc.prototype.ValueTypeName="color";var Pi=class extends Wn{};Pi.prototype.ValueTypeName="number";var Eh=class extends ji{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=(n-t)/(s-t),l=e*a;for(let h=l+a;l!==h;l+=4)tn.slerpFlat(r,0,o,l-a,o,l,c);return r}},ai=class extends Wn{InterpolantFactoryMethodLinear(e){return new Eh(this.times,this.values,this.getValueSize(),e)}};ai.prototype.ValueTypeName="quaternion";ai.prototype.DefaultInterpolation=Rs;ai.prototype.InterpolantFactoryMethodSmooth=void 0;var es=class extends Wn{};es.prototype.ValueTypeName="string";es.prototype.ValueBufferType=Array;es.prototype.DefaultInterpolation=Tr;es.prototype.InterpolantFactoryMethodLinear=void 0;es.prototype.InterpolantFactoryMethodSmooth=void 0;var Li=class extends Wn{};Li.prototype.ValueTypeName="vector";var jn=class{constructor(e,t=-1,n,s=kh){this.name=e,this.tracks=n,this.duration=t,this.blendMode=s,this.uuid=zn(),this.duration<0&&this.resetDuration()}static parse(e){let t=[],n=e.tracks,s=1/(e.fps||1);for(let o=0,a=n.length;o!==a;++o)t.push(jM(n[o]).scale(s));let r=new this(e.name,e.duration,t,e.blendMode);return r.uuid=e.uuid,r}static toJSON(e){let t=[],n=e.tracks,s={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode};for(let r=0,o=n.length;r!==o;++r)t.push(Wn.toJSON(n[r]));return s}static CreateFromMorphTargetSequence(e,t,n,s){let r=t.length,o=[];for(let a=0;a<r;a++){let c=[],l=[];c.push((a+r-1)%r,a,(a+1)%r),l.push(0,1,0);let h=$M(c);c=ip(c,1,h),l=ip(l,1,h),!s&&c[0]===0&&(c.push(r),l.push(l[0])),o.push(new Pi(".morphTargetInfluences["+t[a].name+"]",c,l).scale(1/n))}return new this(e,-1,o)}static findByName(e,t){let n=e;if(!Array.isArray(e)){let s=e;n=s.geometry&&s.geometry.animations||s.animations}for(let s=0;s<n.length;s++)if(n[s].name===t)return n[s];return null}static CreateClipsFromMorphTargetSequences(e,t,n){let s={},r=/^([\w-]*?)([\d]+)$/;for(let a=0,c=e.length;a<c;a++){let l=e[a],h=l.name.match(r);if(h&&h.length>1){let u=h[1],d=s[u];d||(s[u]=d=[]),d.push(l)}}let o=[];for(let a in s)o.push(this.CreateFromMorphTargetSequence(a,s[a],t,n));return o}static parseAnimation(e,t){if(!e)return console.error("THREE.AnimationClip: No animation in JSONLoader data."),null;let n=function(u,d,f,m,_){if(f.length!==0){let g=[],p=[];Up(f,g,p,m),g.length!==0&&_.push(new u(d,g,p))}},s=[],r=e.name||"default",o=e.fps||30,a=e.blendMode,c=e.length||-1,l=e.hierarchy||[];for(let u=0;u<l.length;u++){let d=l[u].keys;if(!(!d||d.length===0))if(d[0].morphTargets){let f={},m;for(m=0;m<d.length;m++)if(d[m].morphTargets)for(let _=0;_<d[m].morphTargets.length;_++)f[d[m].morphTargets[_]]=-1;for(let _ in f){let g=[],p=[];for(let v=0;v!==d[m].morphTargets.length;++v){let x=d[m];g.push(x.time),p.push(x.morphTarget===_?1:0)}s.push(new Pi(".morphTargetInfluence["+_+"]",g,p))}c=f.length*o}else{let f=".bones["+t[u].name+"]";n(Li,f+".position",d,"pos",s),n(ai,f+".quaternion",d,"rot",s),n(Li,f+".scale",d,"scl",s)}}return s.length===0?null:new this(r,c,s,a)}resetDuration(){let e=this.tracks,t=0;for(let n=0,s=e.length;n!==s;++n){let r=this.tracks[n];t=Math.max(t,r.times[r.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e=e&&this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){let e=[];for(let t=0;t<this.tracks.length;t++)e.push(this.tracks[t].clone());return new this.constructor(this.name,this.duration,e,this.blendMode)}toJSON(){return this.constructor.toJSON(this)}};function JM(i){switch(i.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Pi;case"vector":case"vector2":case"vector3":case"vector4":return Li;case"color":return xc;case"quaternion":return ai;case"bool":case"boolean":return Qi;case"string":return es}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+i)}function jM(i){if(i.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");let e=JM(i.type);if(i.times===void 0){let t=[],n=[];Up(i.keys,t,n,"value"),i.times=t,i.values=n}return e.parse!==void 0?e.parse(i):new e(i.name,i.times,i.values,i.interpolation)}var Xi={enabled:!1,files:{},add:function(i,e){this.enabled!==!1&&(this.files[i]=e)},get:function(i){if(this.enabled!==!1)return this.files[i]},remove:function(i){delete this.files[i]},clear:function(){this.files={}}},bh=class{constructor(e,t,n){let s=this,r=!1,o=0,a=0,c,l=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.itemStart=function(h){a++,r===!1&&s.onStart!==void 0&&s.onStart(h,o,a),r=!0},this.itemEnd=function(h){o++,s.onProgress!==void 0&&s.onProgress(h,o,a),o===a&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(h){s.onError!==void 0&&s.onError(h)},this.resolveURL=function(h){return c?c(h):h},this.setURLModifier=function(h){return c=h,this},this.addHandler=function(h,u){return l.push(h,u),this},this.removeHandler=function(h){let u=l.indexOf(h);return u!==-1&&l.splice(u,2),this},this.getHandler=function(h){for(let u=0,d=l.length;u<d;u+=2){let f=l[u],m=l[u+1];if(f.global&&(f.lastIndex=0),f.test(h))return m}return null}}},QM=new bh,Ii=class{constructor(e){this.manager=e!==void 0?e:QM,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){let n=this;return new Promise(function(s,r){n.load(e,s,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}};Ii.DEFAULT_MATERIAL_NAME="__DEFAULT";var Mi={},wh=class extends Error{constructor(e,t){super(e),this.response=t}},ko=class extends Ii{constructor(e){super(e)}load(e,t,n,s){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=Xi.get(e);if(r!==void 0)return this.manager.itemStart(e),setTimeout(()=>{t&&t(r),this.manager.itemEnd(e)},0),r;if(Mi[e]!==void 0){Mi[e].push({onLoad:t,onProgress:n,onError:s});return}Mi[e]=[],Mi[e].push({onLoad:t,onProgress:n,onError:s});let o=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin"}),a=this.mimeType,c=this.responseType;fetch(o).then(l=>{if(l.status===200||l.status===0){if(l.status===0&&console.warn("THREE.FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||l.body===void 0||l.body.getReader===void 0)return l;let h=Mi[e],u=l.body.getReader(),d=l.headers.get("Content-Length")||l.headers.get("X-File-Size"),f=d?parseInt(d):0,m=f!==0,_=0,g=new ReadableStream({start(p){v();function v(){u.read().then(({done:x,value:S})=>{if(x)p.close();else{_+=S.byteLength;let P=new ProgressEvent("progress",{lengthComputable:m,loaded:_,total:f});for(let T=0,R=h.length;T<R;T++){let F=h[T];F.onProgress&&F.onProgress(P)}p.enqueue(S),v()}})}}});return new Response(g)}else throw new wh(`fetch for "${l.url}" responded with ${l.status}: ${l.statusText}`,l)}).then(l=>{switch(c){case"arraybuffer":return l.arrayBuffer();case"blob":return l.blob();case"document":return l.text().then(h=>new DOMParser().parseFromString(h,a));case"json":return l.json();default:if(a===void 0)return l.text();{let u=/charset="?([^;"\s]*)"?/i.exec(a),d=u&&u[1]?u[1].toLowerCase():void 0,f=new TextDecoder(d);return l.arrayBuffer().then(m=>f.decode(m))}}}).then(l=>{Xi.add(e,l);let h=Mi[e];delete Mi[e];for(let u=0,d=h.length;u<d;u++){let f=h[u];f.onLoad&&f.onLoad(l)}}).catch(l=>{let h=Mi[e];if(h===void 0)throw this.manager.itemError(e),l;delete Mi[e];for(let u=0,d=h.length;u<d;u++){let f=h[u];f.onError&&f.onError(l)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}};var Th=class extends Ii{constructor(e){super(e)}load(e,t,n,s){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=this,o=Xi.get(e);if(o!==void 0)return r.manager.itemStart(e),setTimeout(function(){t&&t(o),r.manager.itemEnd(e)},0),o;let a=To("img");function c(){h(),Xi.add(e,this),t&&t(this),r.manager.itemEnd(e)}function l(u){h(),s&&s(u),r.manager.itemError(e),r.manager.itemEnd(e)}function h(){a.removeEventListener("load",c,!1),a.removeEventListener("error",l,!1)}return a.addEventListener("load",c,!1),a.addEventListener("error",l,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(a.crossOrigin=this.crossOrigin),r.manager.itemStart(e),a.src=e,a}};var Ur=class extends Ii{constructor(e){super(e)}load(e,t,n,s){let r=new nn,o=new Th(this.manager);return o.setCrossOrigin(this.crossOrigin),o.setPath(this.path),o.load(e,function(a){r.image=a,r.needsUpdate=!0,t!==void 0&&t(r)},n,s),r}},Or=class extends Tt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Ee(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),t}},yc=class extends Or{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Tt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ee(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}},Vl=new De,sp=new A,rp=new A,zo=class{constructor(e){this.camera=e,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new se(512,512),this.map=null,this.mapPass=null,this.matrix=new De,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Ro,this._frameExtents=new se(1,1),this._viewportCount=1,this._viewports=[new yt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,n=this.matrix;sp.setFromMatrixPosition(e.matrixWorld),t.position.copy(sp),rp.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(rp),t.updateMatrixWorld(),Vl.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Vl),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Vl)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},Ah=class extends zo{constructor(){super(new en(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1}updateMatrices(e){let t=this.camera,n=Ar*2*e.angle*this.focus,s=this.mapSize.width/this.mapSize.height,r=e.distance||t.far;(n!==t.fov||s!==t.aspect||r!==t.far)&&(t.fov=n,t.aspect=s,t.far=r,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}},vc=class extends Or{constructor(e,t,n=0,s=Math.PI/3,r=0,o=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(Tt.DEFAULT_UP),this.updateMatrix(),this.target=new Tt,this.distance=n,this.angle=s,this.penumbra=r,this.decay=o,this.map=null,this.shadow=new Ah}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}},op=new De,_o=new A,Wl=new A,Rh=class extends zo{constructor(){super(new en(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new se(4,2),this._viewportCount=6,this._viewports=[new yt(2,1,1,1),new yt(0,1,1,1),new yt(3,1,1,1),new yt(1,1,1,1),new yt(3,0,1,1),new yt(1,0,1,1)],this._cubeDirections=[new A(1,0,0),new A(-1,0,0),new A(0,0,1),new A(0,0,-1),new A(0,1,0),new A(0,-1,0)],this._cubeUps=[new A(0,1,0),new A(0,1,0),new A(0,1,0),new A(0,1,0),new A(0,0,1),new A(0,0,-1)]}updateMatrices(e,t=0){let n=this.camera,s=this.matrix,r=e.distance||n.far;r!==n.far&&(n.far=r,n.updateProjectionMatrix()),_o.setFromMatrixPosition(e.matrixWorld),n.position.copy(_o),Wl.copy(n.position),Wl.add(this._cubeDirections[t]),n.up.copy(this._cubeUps[t]),n.lookAt(Wl),n.updateMatrixWorld(),s.makeTranslation(-_o.x,-_o.y,-_o.z),op.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(op)}},Mc=class extends Or{constructor(e,t,n=0,s=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=s,this.shadow=new Rh}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}},Ch=class extends zo{constructor(){super(new $i(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Ns=class extends Or{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Tt.DEFAULT_UP),this.updateMatrix(),this.target=new Tt,this.shadow=new Ch}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}};var ts=class{static decodeText(e){if(typeof TextDecoder<"u")return new TextDecoder().decode(e);let t="";for(let n=0,s=e.length;n<s;n++)t+=String.fromCharCode(e[n]);try{return decodeURIComponent(escape(t))}catch{return t}}static extractUrlBase(e){let t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}static resolveURL(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}};var Sc=class extends Ii{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&console.warn("THREE.ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"}}setOptions(e){return this.options=e,this}load(e,t,n,s){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=this,o=Xi.get(e);if(o!==void 0){if(r.manager.itemStart(e),o.then){o.then(l=>{t&&t(l),r.manager.itemEnd(e)}).catch(l=>{s&&s(l)});return}return setTimeout(function(){t&&t(o),r.manager.itemEnd(e)},0),o}let a={};a.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",a.headers=this.requestHeader;let c=fetch(e,a).then(function(l){return l.blob()}).then(function(l){return createImageBitmap(l,Object.assign(r.options,{colorSpaceConversion:"none"}))}).then(function(l){return Xi.add(e,l),t&&t(l),r.manager.itemEnd(e),l}).catch(function(l){s&&s(l),Xi.remove(e),r.manager.itemError(e),r.manager.itemEnd(e)});Xi.add(e,c),r.manager.itemStart(e)}};var Ec=class{constructor(e=!0){this.autoStart=e,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=ap(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let e=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){let t=ap();e=(t-this.oldTime)/1e3,this.oldTime=t,this.elapsedTime+=e}return e}};function ap(){return(typeof performance>"u"?Date:performance).now()}var Ph=class{constructor(e,t,n){this.binding=e,this.valueSize=n;let s,r,o;switch(t){case"quaternion":s=this._slerp,r=this._slerpAdditive,o=this._setAdditiveIdentityQuaternion,this.buffer=new Float64Array(n*6),this._workIndex=5;break;case"string":case"bool":s=this._select,r=this._select,o=this._setAdditiveIdentityOther,this.buffer=new Array(n*5);break;default:s=this._lerp,r=this._lerpAdditive,o=this._setAdditiveIdentityNumeric,this.buffer=new Float64Array(n*5)}this._mixBufferRegion=s,this._mixBufferRegionAdditive=r,this._setIdentity=o,this._origIndex=3,this._addIndex=4,this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,this.useCount=0,this.referenceCount=0}accumulate(e,t){let n=this.buffer,s=this.valueSize,r=e*s+s,o=this.cumulativeWeight;if(o===0){for(let a=0;a!==s;++a)n[r+a]=n[a];o=t}else{o+=t;let a=t/o;this._mixBufferRegion(n,r,0,a,s)}this.cumulativeWeight=o}accumulateAdditive(e){let t=this.buffer,n=this.valueSize,s=n*this._addIndex;this.cumulativeWeightAdditive===0&&this._setIdentity(),this._mixBufferRegionAdditive(t,s,0,e,n),this.cumulativeWeightAdditive+=e}apply(e){let t=this.valueSize,n=this.buffer,s=e*t+t,r=this.cumulativeWeight,o=this.cumulativeWeightAdditive,a=this.binding;if(this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,r<1){let c=t*this._origIndex;this._mixBufferRegion(n,s,c,1-r,t)}o>0&&this._mixBufferRegionAdditive(n,s,this._addIndex*t,1,t);for(let c=t,l=t+t;c!==l;++c)if(n[c]!==n[c+t]){a.setValue(n,s);break}}saveOriginalState(){let e=this.binding,t=this.buffer,n=this.valueSize,s=n*this._origIndex;e.getValue(t,s);for(let r=n,o=s;r!==o;++r)t[r]=t[s+r%n];this._setIdentity(),this.cumulativeWeight=0,this.cumulativeWeightAdditive=0}restoreOriginalState(){let e=this.valueSize*3;this.binding.setValue(this.buffer,e)}_setAdditiveIdentityNumeric(){let e=this._addIndex*this.valueSize,t=e+this.valueSize;for(let n=e;n<t;n++)this.buffer[n]=0}_setAdditiveIdentityQuaternion(){this._setAdditiveIdentityNumeric(),this.buffer[this._addIndex*this.valueSize+3]=1}_setAdditiveIdentityOther(){let e=this._origIndex*this.valueSize,t=this._addIndex*this.valueSize;for(let n=0;n<this.valueSize;n++)this.buffer[t+n]=this.buffer[e+n]}_select(e,t,n,s,r){if(s>=.5)for(let o=0;o!==r;++o)e[t+o]=e[n+o]}_slerp(e,t,n,s){tn.slerpFlat(e,t,e,t,e,n,s)}_slerpAdditive(e,t,n,s,r){let o=this._workIndex*r;tn.multiplyQuaternionsFlat(e,o,e,t,e,n),tn.slerpFlat(e,t,e,t,e,o,s)}_lerp(e,t,n,s,r){let o=1-s;for(let a=0;a!==r;++a){let c=t+a;e[c]=e[c]*o+e[n+a]*s}}_lerpAdditive(e,t,n,s,r){for(let o=0;o!==r;++o){let a=t+o;e[a]=e[a]+e[n+o]*s}}},Wh="\\[\\]\\.:\\/",eS=new RegExp("["+Wh+"]","g"),Xh="[^"+Wh+"]",tS="[^"+Wh.replace("\\.","")+"]",nS=/((?:WC+[\/:])*)/.source.replace("WC",Xh),iS=/(WCOD+)?/.source.replace("WCOD",tS),sS=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Xh),rS=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Xh),oS=new RegExp("^"+nS+iS+sS+rS+"$"),aS=["material","materials","bones","map"],Lh=class{constructor(e,t,n){let s=n||xt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,s)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},xt=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(eS,"")}static parseTrackName(e){let t=oS.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=n.nodeName.substring(s+1);aS.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let o=0;o<r.length;o++){let a=r[o];if(a.name===t||a.uuid===t)return a;let c=n(a.children);if(c)return c}return null},s=n(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)e[t++]=n[s]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,s=t.propertyName,r=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let l=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===l){l=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(l!==void 0){if(e[l]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[l]}}let o=e[s];if(o===void 0){let l=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+l+"."+s+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.needsUpdate!==void 0?a=this.Versioning.NeedsUpdate:e.matrixWorldNeedsUpdate!==void 0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=r}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=s;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};xt.Composite=Lh;xt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};xt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};xt.prototype.GetterByBindingType=[xt.prototype._getValue_direct,xt.prototype._getValue_array,xt.prototype._getValue_arrayElement,xt.prototype._getValue_toArray];xt.prototype.SetterByBindingTypeAndVersioning=[[xt.prototype._setValue_direct,xt.prototype._setValue_direct_setNeedsUpdate,xt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[xt.prototype._setValue_array,xt.prototype._setValue_array_setNeedsUpdate,xt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[xt.prototype._setValue_arrayElement,xt.prototype._setValue_arrayElement_setNeedsUpdate,xt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[xt.prototype._setValue_fromArray,xt.prototype._setValue_fromArray_setNeedsUpdate,xt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var Ih=class{constructor(e,t,n=null,s=t.blendMode){this._mixer=e,this._clip=t,this._localRoot=n,this.blendMode=s;let r=t.tracks,o=r.length,a=new Array(o),c={endingStart:pr,endingEnd:pr};for(let l=0;l!==o;++l){let h=r[l].createInterpolant(null);a[l]=h,h.settings=c}this._interpolantSettings=c,this._interpolants=a,this._propertyBindings=new Array(o),this._cacheIndex=null,this._byClipCacheIndex=null,this._timeScaleInterpolant=null,this._weightInterpolant=null,this.loop=e0,this._loopCount=-1,this._startTime=null,this.time=0,this.timeScale=1,this._effectiveTimeScale=1,this.weight=1,this._effectiveWeight=1,this.repetitions=1/0,this.paused=!1,this.enabled=!0,this.clampWhenFinished=!1,this.zeroSlopeAtStart=!0,this.zeroSlopeAtEnd=!0}play(){return this._mixer._activateAction(this),this}stop(){return this._mixer._deactivateAction(this),this.reset()}reset(){return this.paused=!1,this.enabled=!0,this.time=0,this._loopCount=-1,this._startTime=null,this.stopFading().stopWarping()}isRunning(){return this.enabled&&!this.paused&&this.timeScale!==0&&this._startTime===null&&this._mixer._isActiveAction(this)}isScheduled(){return this._mixer._isActiveAction(this)}startAt(e){return this._startTime=e,this}setLoop(e,t){return this.loop=e,this.repetitions=t,this}setEffectiveWeight(e){return this.weight=e,this._effectiveWeight=this.enabled?e:0,this.stopFading()}getEffectiveWeight(){return this._effectiveWeight}fadeIn(e){return this._scheduleFading(e,0,1)}fadeOut(e){return this._scheduleFading(e,1,0)}crossFadeFrom(e,t,n){if(e.fadeOut(t),this.fadeIn(t),n){let s=this._clip.duration,r=e._clip.duration,o=r/s,a=s/r;e.warp(1,o,t),this.warp(a,1,t)}return this}crossFadeTo(e,t,n){return e.crossFadeFrom(this,t,n)}stopFading(){let e=this._weightInterpolant;return e!==null&&(this._weightInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this}setEffectiveTimeScale(e){return this.timeScale=e,this._effectiveTimeScale=this.paused?0:e,this.stopWarping()}getEffectiveTimeScale(){return this._effectiveTimeScale}setDuration(e){return this.timeScale=this._clip.duration/e,this.stopWarping()}syncWith(e){return this.time=e.time,this.timeScale=e.timeScale,this.stopWarping()}halt(e){return this.warp(this._effectiveTimeScale,0,e)}warp(e,t,n){let s=this._mixer,r=s.time,o=this.timeScale,a=this._timeScaleInterpolant;a===null&&(a=s._lendControlInterpolant(),this._timeScaleInterpolant=a);let c=a.parameterPositions,l=a.sampleValues;return c[0]=r,c[1]=r+n,l[0]=e/o,l[1]=t/o,this}stopWarping(){let e=this._timeScaleInterpolant;return e!==null&&(this._timeScaleInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this}getMixer(){return this._mixer}getClip(){return this._clip}getRoot(){return this._localRoot||this._mixer._root}_update(e,t,n,s){if(!this.enabled){this._updateWeight(e);return}let r=this._startTime;if(r!==null){let c=(e-r)*n;c<0||n===0?t=0:(this._startTime=null,t=n*c)}t*=this._updateTimeScale(e);let o=this._updateTime(t),a=this._updateWeight(e);if(a>0){let c=this._interpolants,l=this._propertyBindings;switch(this.blendMode){case n0:for(let h=0,u=c.length;h!==u;++h)c[h].evaluate(o),l[h].accumulateAdditive(a);break;case kh:default:for(let h=0,u=c.length;h!==u;++h)c[h].evaluate(o),l[h].accumulate(s,a)}}}_updateWeight(e){let t=0;if(this.enabled){t=this.weight;let n=this._weightInterpolant;if(n!==null){let s=n.evaluate(e)[0];t*=s,e>n.parameterPositions[1]&&(this.stopFading(),s===0&&(this.enabled=!1))}}return this._effectiveWeight=t,t}_updateTimeScale(e){let t=0;if(!this.paused){t=this.timeScale;let n=this._timeScaleInterpolant;if(n!==null){let s=n.evaluate(e)[0];t*=s,e>n.parameterPositions[1]&&(this.stopWarping(),t===0?this.paused=!0:this.timeScale=t)}}return this._effectiveTimeScale=t,t}_updateTime(e){let t=this._clip.duration,n=this.loop,s=this.time+e,r=this._loopCount,o=n===t0;if(e===0)return r===-1?s:o&&(r&1)===1?t-s:s;if(n===Bh){r===-1&&(this._loopCount=0,this._setEndings(!0,!0,!1));e:{if(s>=t)s=t;else if(s<0)s=0;else{this.time=s;break e}this.clampWhenFinished?this.paused=!0:this.enabled=!1,this.time=s,this._mixer.dispatchEvent({type:"finished",action:this,direction:e<0?-1:1})}}else{if(r===-1&&(e>=0?(r=0,this._setEndings(!0,this.repetitions===0,o)):this._setEndings(this.repetitions===0,!0,o)),s>=t||s<0){let a=Math.floor(s/t);s-=t*a,r+=Math.abs(a);let c=this.repetitions-r;if(c<=0)this.clampWhenFinished?this.paused=!0:this.enabled=!1,s=e>0?t:0,this.time=s,this._mixer.dispatchEvent({type:"finished",action:this,direction:e>0?1:-1});else{if(c===1){let l=e<0;this._setEndings(l,!l,o)}else this._setEndings(!1,!1,o);this._loopCount=r,this.time=s,this._mixer.dispatchEvent({type:"loop",action:this,loopDelta:a})}}else this.time=s;if(o&&(r&1)===1)return t-s}return s}_setEndings(e,t,n){let s=this._interpolantSettings;n?(s.endingStart=mr,s.endingEnd=mr):(e?s.endingStart=this.zeroSlopeAtStart?mr:pr:s.endingStart=za,t?s.endingEnd=this.zeroSlopeAtEnd?mr:pr:s.endingEnd=za)}_scheduleFading(e,t,n){let s=this._mixer,r=s.time,o=this._weightInterpolant;o===null&&(o=s._lendControlInterpolant(),this._weightInterpolant=o);let a=o.parameterPositions,c=o.sampleValues;return a[0]=r,c[0]=t,a[1]=r+e,c[1]=n,this}},cS=new Float32Array(1),bc=class extends Ai{constructor(e){super(),this._root=e,this._initMemoryManager(),this._accuIndex=0,this.time=0,this.timeScale=1}_bindAction(e,t){let n=e._localRoot||this._root,s=e._clip.tracks,r=s.length,o=e._propertyBindings,a=e._interpolants,c=n.uuid,l=this._bindingsByRootAndName,h=l[c];h===void 0&&(h={},l[c]=h);for(let u=0;u!==r;++u){let d=s[u],f=d.name,m=h[f];if(m!==void 0)++m.referenceCount,o[u]=m;else{if(m=o[u],m!==void 0){m._cacheIndex===null&&(++m.referenceCount,this._addInactiveBinding(m,c,f));continue}let _=t&&t._propertyBindings[u].binding.parsedPath;m=new Ph(xt.create(n,f,_),d.ValueTypeName,d.getValueSize()),++m.referenceCount,this._addInactiveBinding(m,c,f),o[u]=m}a[u].resultBuffer=m.buffer}}_activateAction(e){if(!this._isActiveAction(e)){if(e._cacheIndex===null){let n=(e._localRoot||this._root).uuid,s=e._clip.uuid,r=this._actionsByClip[s];this._bindAction(e,r&&r.knownActions[0]),this._addInactiveAction(e,s,n)}let t=e._propertyBindings;for(let n=0,s=t.length;n!==s;++n){let r=t[n];r.useCount++===0&&(this._lendBinding(r),r.saveOriginalState())}this._lendAction(e)}}_deactivateAction(e){if(this._isActiveAction(e)){let t=e._propertyBindings;for(let n=0,s=t.length;n!==s;++n){let r=t[n];--r.useCount===0&&(r.restoreOriginalState(),this._takeBackBinding(r))}this._takeBackAction(e)}}_initMemoryManager(){this._actions=[],this._nActiveActions=0,this._actionsByClip={},this._bindings=[],this._nActiveBindings=0,this._bindingsByRootAndName={},this._controlInterpolants=[],this._nActiveControlInterpolants=0;let e=this;this.stats={actions:{get total(){return e._actions.length},get inUse(){return e._nActiveActions}},bindings:{get total(){return e._bindings.length},get inUse(){return e._nActiveBindings}},controlInterpolants:{get total(){return e._controlInterpolants.length},get inUse(){return e._nActiveControlInterpolants}}}}_isActiveAction(e){let t=e._cacheIndex;return t!==null&&t<this._nActiveActions}_addInactiveAction(e,t,n){let s=this._actions,r=this._actionsByClip,o=r[t];if(o===void 0)o={knownActions:[e],actionByRoot:{}},e._byClipCacheIndex=0,r[t]=o;else{let a=o.knownActions;e._byClipCacheIndex=a.length,a.push(e)}e._cacheIndex=s.length,s.push(e),o.actionByRoot[n]=e}_removeInactiveAction(e){let t=this._actions,n=t[t.length-1],s=e._cacheIndex;n._cacheIndex=s,t[s]=n,t.pop(),e._cacheIndex=null;let r=e._clip.uuid,o=this._actionsByClip,a=o[r],c=a.knownActions,l=c[c.length-1],h=e._byClipCacheIndex;l._byClipCacheIndex=h,c[h]=l,c.pop(),e._byClipCacheIndex=null;let u=a.actionByRoot,d=(e._localRoot||this._root).uuid;delete u[d],c.length===0&&delete o[r],this._removeInactiveBindingsForAction(e)}_removeInactiveBindingsForAction(e){let t=e._propertyBindings;for(let n=0,s=t.length;n!==s;++n){let r=t[n];--r.referenceCount===0&&this._removeInactiveBinding(r)}}_lendAction(e){let t=this._actions,n=e._cacheIndex,s=this._nActiveActions++,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_takeBackAction(e){let t=this._actions,n=e._cacheIndex,s=--this._nActiveActions,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_addInactiveBinding(e,t,n){let s=this._bindingsByRootAndName,r=this._bindings,o=s[t];o===void 0&&(o={},s[t]=o),o[n]=e,e._cacheIndex=r.length,r.push(e)}_removeInactiveBinding(e){let t=this._bindings,n=e.binding,s=n.rootNode.uuid,r=n.path,o=this._bindingsByRootAndName,a=o[s],c=t[t.length-1],l=e._cacheIndex;c._cacheIndex=l,t[l]=c,t.pop(),delete a[r],Object.keys(a).length===0&&delete o[s]}_lendBinding(e){let t=this._bindings,n=e._cacheIndex,s=this._nActiveBindings++,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_takeBackBinding(e){let t=this._bindings,n=e._cacheIndex,s=--this._nActiveBindings,r=t[s];e._cacheIndex=s,t[s]=e,r._cacheIndex=n,t[n]=r}_lendControlInterpolant(){let e=this._controlInterpolants,t=this._nActiveControlInterpolants++,n=e[t];return n===void 0&&(n=new _c(new Float32Array(2),new Float32Array(2),1,cS),n.__cacheIndex=t,e[t]=n),n}_takeBackControlInterpolant(e){let t=this._controlInterpolants,n=e.__cacheIndex,s=--this._nActiveControlInterpolants,r=t[s];e.__cacheIndex=s,t[s]=e,r.__cacheIndex=n,t[n]=r}clipAction(e,t,n){let s=t||this._root,r=s.uuid,o=typeof e=="string"?jn.findByName(s,e):e,a=o!==null?o.uuid:e,c=this._actionsByClip[a],l=null;if(n===void 0&&(o!==null?n=o.blendMode:n=kh),c!==void 0){let u=c.actionByRoot[r];if(u!==void 0&&u.blendMode===n)return u;l=c.knownActions[0],o===null&&(o=l._clip)}if(o===null)return null;let h=new Ih(this,o,t,n);return this._bindAction(h,l),this._addInactiveAction(h,a,r),h}existingAction(e,t){let n=t||this._root,s=n.uuid,r=typeof e=="string"?jn.findByName(n,e):e,o=r?r.uuid:e,a=this._actionsByClip[o];return a!==void 0&&a.actionByRoot[s]||null}stopAllAction(){let e=this._actions,t=this._nActiveActions;for(let n=t-1;n>=0;--n)e[n].stop();return this}update(e){e*=this.timeScale;let t=this._actions,n=this._nActiveActions,s=this.time+=e,r=Math.sign(e),o=this._accuIndex^=1;for(let l=0;l!==n;++l)t[l]._update(s,e,r,o);let a=this._bindings,c=this._nActiveBindings;for(let l=0;l!==c;++l)a[l].apply(o);return this}setTime(e){this.time=0;for(let t=0;t<this._actions.length;t++)this._actions[t].time=0;return this.update(e)}getRoot(){return this._root}uncacheClip(e){let t=this._actions,n=e.uuid,s=this._actionsByClip,r=s[n];if(r!==void 0){let o=r.knownActions;for(let a=0,c=o.length;a!==c;++a){let l=o[a];this._deactivateAction(l);let h=l._cacheIndex,u=t[t.length-1];l._cacheIndex=null,l._byClipCacheIndex=null,u._cacheIndex=h,t[h]=u,t.pop(),this._removeInactiveBindingsForAction(l)}delete s[n]}}uncacheRoot(e){let t=e.uuid,n=this._actionsByClip;for(let o in n){let a=n[o].actionByRoot,c=a[t];c!==void 0&&(this._deactivateAction(c),this._removeInactiveAction(c))}let s=this._bindingsByRootAndName,r=s[t];if(r!==void 0)for(let o in r){let a=r[o];a.restoreOriginalState(),this._removeInactiveBinding(a)}}uncacheAction(e,t){let n=this.existingAction(e,t);n!==null&&(this._deactivateAction(n),this._removeInactiveAction(n))}};var wc=class{constructor(e,t,n=0,s=1/0){this.ray=new Cs(e,t),this.near=n,this.far=s,this.camera=null,this.layers=new Ao,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}intersectObject(e,t=!0,n=[]){return Dh(e,this,n,t),n.sort(cp),n}intersectObjects(e,t=!0,n=[]){for(let s=0,r=e.length;s<r;s++)Dh(e[s],this,n,t);return n.sort(cp),n}};function cp(i,e){return i.distance-e.distance}function Dh(i,e,t,n){if(i.layers.test(e.layers)&&i.raycast(e,t),n===!0){let s=i.children;for(let r=0,o=s.length;r<o;r++)Dh(s[r],e,t,!0)}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Nh}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Nh);function qh(i,e){if(e===yp)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),i;if(e===Ho||e===Ac){let t=i.getIndex();if(t===null){let o=[],a=i.getAttribute("position");if(a!==void 0){for(let c=0;c<a.count;c++)o.push(c);i.setIndex(o),t=i.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),i}let n=t.count-2,s=[];if(e===Ho)for(let o=1;o<=n;o++)s.push(t.getX(0)),s.push(t.getX(o)),s.push(t.getX(o+1));else for(let o=0;o<n;o++)o%2===0?(s.push(t.getX(o)),s.push(t.getX(o+1)),s.push(t.getX(o+2))):(s.push(t.getX(o+2)),s.push(t.getX(o+1)),s.push(t.getX(o)));s.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");let r=i.clone();return r.setIndex(s),r.clearGroups(),r}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),i}var Lc=class extends Ii{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new Qh(t)}),this.register(function(t){return new cu(t)}),this.register(function(t){return new lu(t)}),this.register(function(t){return new hu(t)}),this.register(function(t){return new tu(t)}),this.register(function(t){return new nu(t)}),this.register(function(t){return new iu(t)}),this.register(function(t){return new su(t)}),this.register(function(t){return new jh(t)}),this.register(function(t){return new ru(t)}),this.register(function(t){return new eu(t)}),this.register(function(t){return new au(t)}),this.register(function(t){return new ou(t)}),this.register(function(t){return new $h(t)}),this.register(function(t){return new uu(t)}),this.register(function(t){return new du(t)})}load(e,t,n,s){let r=this,o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){let l=ts.extractUrlBase(e);o=ts.resolveURL(l,this.path)}else o=ts.extractUrlBase(e);this.manager.itemStart(e);let a=function(l){s?s(l):console.error(l),r.manager.itemError(e),r.manager.itemEnd(e)},c=new ko(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(this.withCredentials),c.load(e,function(l){try{r.parse(l,o,function(h){t(h),r.manager.itemEnd(e)},a)}catch(h){a(h)}},n,a)}setDRACOLoader(e){return this.dracoLoader=e,this}setDDSLoader(){throw new Error('THREE.GLTFLoader: "MSFT_texture_dds" no longer supported. Please update to "KHR_texture_basisu".')}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,s){let r,o={},a={},c=new TextDecoder;if(typeof e=="string")r=JSON.parse(e);else if(e instanceof ArrayBuffer)if(c.decode(new Uint8Array(e,0,4))===zp){try{o[st.KHR_BINARY_GLTF]=new fu(e)}catch(u){s&&s(u);return}r=JSON.parse(o[st.KHR_BINARY_GLTF].content)}else r=JSON.parse(c.decode(e));else r=e;if(r.asset===void 0||r.asset.version[0]<2){s&&s(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}let l=new vu(r,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});l.fileLoader.setRequestHeader(this.requestHeader);for(let h=0;h<this.pluginCallbacks.length;h++){let u=this.pluginCallbacks[h](l);u.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),a[u.name]=u,o[u.name]=!0}if(r.extensionsUsed)for(let h=0;h<r.extensionsUsed.length;++h){let u=r.extensionsUsed[h],d=r.extensionsRequired||[];switch(u){case st.KHR_MATERIALS_UNLIT:o[u]=new Jh;break;case st.KHR_DRACO_MESH_COMPRESSION:o[u]=new pu(r,this.dracoLoader);break;case st.KHR_TEXTURE_TRANSFORM:o[u]=new mu;break;case st.KHR_MESH_QUANTIZATION:o[u]=new gu;break;default:d.indexOf(u)>=0&&a[u]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+u+'".')}}l.setExtensions(o),l.setPlugins(a),l.parse(n,s)}parseAsync(e,t){let n=this;return new Promise(function(s,r){n.parse(e,t,s,r)})}};function hS(){let i={};return{get:function(e){return i[e]},add:function(e,t){i[e]=t},remove:function(e){delete i[e]},removeAll:function(){i={}}}}var st={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"},$h=class{constructor(e){this.parser=e,this.name=st.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){let e=this.parser,t=this.parser.json.nodes||[];for(let n=0,s=t.length;n<s;n++){let r=t[n];r.extensions&&r.extensions[this.name]&&r.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,r.extensions[this.name].light)}}_loadLight(e){let t=this.parser,n="light:"+e,s=t.cache.get(n);if(s)return s;let r=t.json,c=((r.extensions&&r.extensions[this.name]||{}).lights||[])[e],l,h=new Ee(16777215);c.color!==void 0&&h.setRGB(c.color[0],c.color[1],c.color[2],Ht);let u=c.range!==void 0?c.range:0;switch(c.type){case"directional":l=new Ns(h),l.target.position.set(0,0,-1),l.add(l.target);break;case"point":l=new Mc(h),l.distance=u;break;case"spot":l=new vc(h),l.distance=u,c.spot=c.spot||{},c.spot.innerConeAngle=c.spot.innerConeAngle!==void 0?c.spot.innerConeAngle:0,c.spot.outerConeAngle=c.spot.outerConeAngle!==void 0?c.spot.outerConeAngle:Math.PI/4,l.angle=c.spot.outerConeAngle,l.penumbra=1-c.spot.innerConeAngle/c.spot.outerConeAngle,l.target.position.set(0,0,-1),l.add(l.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+c.type)}return l.position.set(0,0,0),l.decay=2,is(l,c),c.intensity!==void 0&&(l.intensity=c.intensity),l.name=t.createUniqueName(c.name||"light_"+e),s=Promise.resolve(l),t.cache.add(n,s),s}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){let t=this,n=this.parser,r=n.json.nodes[e],a=(r.extensions&&r.extensions[this.name]||{}).light;return a===void 0?null:this._loadLight(a).then(function(c){return n._getNodeRef(t.cache,a,c)})}},Jh=class{constructor(){this.name=st.KHR_MATERIALS_UNLIT}getMaterialType(){return rt}extendParams(e,t,n){let s=[];e.color=new Ee(1,1,1),e.opacity=1;let r=t.pbrMetallicRoughness;if(r){if(Array.isArray(r.baseColorFactor)){let o=r.baseColorFactor;e.color.setRGB(o[0],o[1],o[2],Ht),e.opacity=o[3]}r.baseColorTexture!==void 0&&s.push(n.assignTexture(e,"map",r.baseColorTexture,_t))}return Promise.all(s)}},jh=class{constructor(e){this.parser=e,this.name=st.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){let s=this.parser.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=s.extensions[this.name].emissiveStrength;return r!==void 0&&(t.emissiveIntensity=r),Promise.resolve()}},Qh=class{constructor(e){this.parser=e,this.name=st.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:Vn}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];if(o.clearcoatFactor!==void 0&&(t.clearcoat=o.clearcoatFactor),o.clearcoatTexture!==void 0&&r.push(n.assignTexture(t,"clearcoatMap",o.clearcoatTexture)),o.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=o.clearcoatRoughnessFactor),o.clearcoatRoughnessTexture!==void 0&&r.push(n.assignTexture(t,"clearcoatRoughnessMap",o.clearcoatRoughnessTexture)),o.clearcoatNormalTexture!==void 0&&(r.push(n.assignTexture(t,"clearcoatNormalMap",o.clearcoatNormalTexture)),o.clearcoatNormalTexture.scale!==void 0)){let a=o.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new se(a,a)}return Promise.all(r)}},eu=class{constructor(e){this.parser=e,this.name=st.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:Vn}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];return o.iridescenceFactor!==void 0&&(t.iridescence=o.iridescenceFactor),o.iridescenceTexture!==void 0&&r.push(n.assignTexture(t,"iridescenceMap",o.iridescenceTexture)),o.iridescenceIor!==void 0&&(t.iridescenceIOR=o.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),o.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=o.iridescenceThicknessMinimum),o.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=o.iridescenceThicknessMaximum),o.iridescenceThicknessTexture!==void 0&&r.push(n.assignTexture(t,"iridescenceThicknessMap",o.iridescenceThicknessTexture)),Promise.all(r)}},tu=class{constructor(e){this.parser=e,this.name=st.KHR_MATERIALS_SHEEN}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:Vn}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[];t.sheenColor=new Ee(0,0,0),t.sheenRoughness=0,t.sheen=1;let o=s.extensions[this.name];if(o.sheenColorFactor!==void 0){let a=o.sheenColorFactor;t.sheenColor.setRGB(a[0],a[1],a[2],Ht)}return o.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=o.sheenRoughnessFactor),o.sheenColorTexture!==void 0&&r.push(n.assignTexture(t,"sheenColorMap",o.sheenColorTexture,_t)),o.sheenRoughnessTexture!==void 0&&r.push(n.assignTexture(t,"sheenRoughnessMap",o.sheenRoughnessTexture)),Promise.all(r)}},nu=class{constructor(e){this.parser=e,this.name=st.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:Vn}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];return o.transmissionFactor!==void 0&&(t.transmission=o.transmissionFactor),o.transmissionTexture!==void 0&&r.push(n.assignTexture(t,"transmissionMap",o.transmissionTexture)),Promise.all(r)}},iu=class{constructor(e){this.parser=e,this.name=st.KHR_MATERIALS_VOLUME}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:Vn}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];t.thickness=o.thicknessFactor!==void 0?o.thicknessFactor:0,o.thicknessTexture!==void 0&&r.push(n.assignTexture(t,"thicknessMap",o.thicknessTexture)),t.attenuationDistance=o.attenuationDistance||1/0;let a=o.attenuationColor||[1,1,1];return t.attenuationColor=new Ee().setRGB(a[0],a[1],a[2],Ht),Promise.all(r)}},su=class{constructor(e){this.parser=e,this.name=st.KHR_MATERIALS_IOR}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:Vn}extendMaterialParams(e,t){let s=this.parser.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=s.extensions[this.name];return t.ior=r.ior!==void 0?r.ior:1.5,Promise.resolve()}},ru=class{constructor(e){this.parser=e,this.name=st.KHR_MATERIALS_SPECULAR}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:Vn}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];t.specularIntensity=o.specularFactor!==void 0?o.specularFactor:1,o.specularTexture!==void 0&&r.push(n.assignTexture(t,"specularIntensityMap",o.specularTexture));let a=o.specularColorFactor||[1,1,1];return t.specularColor=new Ee().setRGB(a[0],a[1],a[2],Ht),o.specularColorTexture!==void 0&&r.push(n.assignTexture(t,"specularColorMap",o.specularColorTexture,_t)),Promise.all(r)}},ou=class{constructor(e){this.parser=e,this.name=st.EXT_MATERIALS_BUMP}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:Vn}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];return t.bumpScale=o.bumpFactor!==void 0?o.bumpFactor:1,o.bumpTexture!==void 0&&r.push(n.assignTexture(t,"bumpMap",o.bumpTexture)),Promise.all(r)}},au=class{constructor(e){this.parser=e,this.name=st.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:Vn}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];return o.anisotropyStrength!==void 0&&(t.anisotropy=o.anisotropyStrength),o.anisotropyRotation!==void 0&&(t.anisotropyRotation=o.anisotropyRotation),o.anisotropyTexture!==void 0&&r.push(n.assignTexture(t,"anisotropyMap",o.anisotropyTexture)),Promise.all(r)}},cu=class{constructor(e){this.parser=e,this.name=st.KHR_TEXTURE_BASISU}loadTexture(e){let t=this.parser,n=t.json,s=n.textures[e];if(!s.extensions||!s.extensions[this.name])return null;let r=s.extensions[this.name],o=t.options.ktx2Loader;if(!o){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,r.source,o)}},lu=class{constructor(e){this.parser=e,this.name=st.EXT_TEXTURE_WEBP,this.isSupported=null}loadTexture(e){let t=this.name,n=this.parser,s=n.json,r=s.textures[e];if(!r.extensions||!r.extensions[t])return null;let o=r.extensions[t],a=s.images[o.source],c=n.textureLoader;if(a.uri){let l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return this.detectSupport().then(function(l){if(l)return n.loadTextureImage(e,o.source,c);if(s.extensionsRequired&&s.extensionsRequired.indexOf(t)>=0)throw new Error("THREE.GLTFLoader: WebP required by asset but unsupported.");return n.loadTexture(e)})}detectSupport(){return this.isSupported||(this.isSupported=new Promise(function(e){let t=new Image;t.src="data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",t.onload=t.onerror=function(){e(t.height===1)}})),this.isSupported}},hu=class{constructor(e){this.parser=e,this.name=st.EXT_TEXTURE_AVIF,this.isSupported=null}loadTexture(e){let t=this.name,n=this.parser,s=n.json,r=s.textures[e];if(!r.extensions||!r.extensions[t])return null;let o=r.extensions[t],a=s.images[o.source],c=n.textureLoader;if(a.uri){let l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return this.detectSupport().then(function(l){if(l)return n.loadTextureImage(e,o.source,c);if(s.extensionsRequired&&s.extensionsRequired.indexOf(t)>=0)throw new Error("THREE.GLTFLoader: AVIF required by asset but unsupported.");return n.loadTexture(e)})}detectSupport(){return this.isSupported||(this.isSupported=new Promise(function(e){let t=new Image;t.src="data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAABcAAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAB9tZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI=",t.onload=t.onerror=function(){e(t.height===1)}})),this.isSupported}},uu=class{constructor(e){this.name=st.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){let t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){let s=n.extensions[this.name],r=this.parser.getDependency("buffer",s.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return r.then(function(a){let c=s.byteOffset||0,l=s.byteLength||0,h=s.count,u=s.byteStride,d=new Uint8Array(a,c,l);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(h,u,d,s.mode,s.filter).then(function(f){return f.buffer}):o.ready.then(function(){let f=new ArrayBuffer(h*u);return o.decodeGltfBuffer(new Uint8Array(f),h,u,d,s.mode,s.filter),f})})}else return null}},du=class{constructor(e){this.name=st.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){let t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;let s=t.meshes[n.mesh];for(let l of s.primitives)if(l.mode!==Xn.TRIANGLES&&l.mode!==Xn.TRIANGLE_STRIP&&l.mode!==Xn.TRIANGLE_FAN&&l.mode!==void 0)return null;let o=n.extensions[this.name].attributes,a=[],c={};for(let l in o)a.push(this.parser.getDependency("accessor",o[l]).then(h=>(c[l]=h,c[l])));return a.length<1?null:(a.push(this.parser.createNodeMesh(e)),Promise.all(a).then(l=>{let h=l.pop(),u=h.isGroup?h.children:[h],d=l[0].count,f=[];for(let m of u){let _=new De,g=new A,p=new tn,v=new A(1,1,1),x=new Hn(m.geometry,m.material,d);for(let S=0;S<d;S++)c.TRANSLATION&&g.fromBufferAttribute(c.TRANSLATION,S),c.ROTATION&&p.fromBufferAttribute(c.ROTATION,S),c.SCALE&&v.fromBufferAttribute(c.SCALE,S),x.setMatrixAt(S,_.compose(g,p,v));for(let S in c)if(S==="_COLOR_0"){let P=c[S];x.instanceColor=new Ps(P.array,P.itemSize,P.normalized)}else S!=="TRANSLATION"&&S!=="ROTATION"&&S!=="SCALE"&&m.geometry.setAttribute(S,c[S]);Tt.prototype.copy.call(x,m),this.parser.assignFinalMaterial(x),f.push(x)}return h.isGroup?(h.clear(),h.add(...f),h):f[0]}))}},zp="glTF",Go=12,Op={JSON:1313821514,BIN:5130562},fu=class{constructor(e){this.name=st.KHR_BINARY_GLTF,this.content=null,this.body=null;let t=new DataView(e,0,Go),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==zp)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");let s=this.header.length-Go,r=new DataView(e,Go),o=0;for(;o<s;){let a=r.getUint32(o,!0);o+=4;let c=r.getUint32(o,!0);if(o+=4,c===Op.JSON){let l=new Uint8Array(e,Go+o,a);this.content=n.decode(l)}else if(c===Op.BIN){let l=Go+o;this.body=e.slice(l,l+a)}o+=a}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}},pu=class{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=st.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){let n=this.json,s=this.dracoLoader,r=e.extensions[this.name].bufferView,o=e.extensions[this.name].attributes,a={},c={},l={};for(let h in o){let u=xu[h]||h.toLowerCase();a[u]=o[h]}for(let h in e.attributes){let u=xu[h]||h.toLowerCase();if(o[h]!==void 0){let d=n.accessors[e.attributes[h]],f=kr[d.componentType];l[u]=f.name,c[u]=d.normalized===!0}}return t.getDependency("bufferView",r).then(function(h){return new Promise(function(u,d){s.decodeDracoFile(h,function(f){for(let m in f.attributes){let _=f.attributes[m],g=c[m];g!==void 0&&(_.normalized=g)}u(f)},a,l,Ht,d)})})}},mu=class{constructor(){this.name=st.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}},gu=class{constructor(){this.name=st.KHR_MESH_QUANTIZATION}},Ic=class extends ji{constructor(e,t,n,s){super(e,t,n,s)}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s*3+s;for(let o=0;o!==s;o++)t[o]=n[r+o];return t}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=a*2,l=a*3,h=s-t,u=(n-t)/h,d=u*u,f=d*u,m=e*l,_=m-l,g=-2*f+3*d,p=f-d,v=1-g,x=p-d+u;for(let S=0;S!==a;S++){let P=o[_+S+a],T=o[_+S+c]*h,R=o[m+S+a],F=o[m+S]*h;r[S]=v*P+x*T+g*R+p*F}return r}},uS=new tn,_u=class extends Ic{interpolate_(e,t,n,s){let r=super.interpolate_(e,t,n,s);return uS.fromArray(r).normalize().toArray(r),r}},Xn={FLOAT:5126,FLOAT_MAT3:35675,FLOAT_MAT4:35676,FLOAT_VEC2:35664,FLOAT_VEC3:35665,FLOAT_VEC4:35666,LINEAR:9729,REPEAT:10497,SAMPLER_2D:35678,POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6,UNSIGNED_BYTE:5121,UNSIGNED_SHORT:5123},kr={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},Fp={9728:zt,9729:_n,9984:ka,9985:Oh,9986:xo,9987:Ki},Bp={33071:Cn,33648:bo,10497:Ti},Yh={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},xu={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},ns={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},dS={CUBICSPLINE:void 0,LINEAR:Rs,STEP:Tr},Zh={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function fS(i){return i.DefaultMaterial===void 0&&(i.DefaultMaterial=new ht({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:oi})),i.DefaultMaterial}function Us(i,e,t){for(let n in t.extensions)i[n]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[n]=t.extensions[n])}function is(i,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(i.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function pS(i,e,t){let n=!1,s=!1,r=!1;for(let l=0,h=e.length;l<h;l++){let u=e[l];if(u.POSITION!==void 0&&(n=!0),u.NORMAL!==void 0&&(s=!0),u.COLOR_0!==void 0&&(r=!0),n&&s&&r)break}if(!n&&!s&&!r)return Promise.resolve(i);let o=[],a=[],c=[];for(let l=0,h=e.length;l<h;l++){let u=e[l];if(n){let d=u.POSITION!==void 0?t.getDependency("accessor",u.POSITION):i.attributes.position;o.push(d)}if(s){let d=u.NORMAL!==void 0?t.getDependency("accessor",u.NORMAL):i.attributes.normal;a.push(d)}if(r){let d=u.COLOR_0!==void 0?t.getDependency("accessor",u.COLOR_0):i.attributes.color;c.push(d)}}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c)]).then(function(l){let h=l[0],u=l[1],d=l[2];return n&&(i.morphAttributes.position=h),s&&(i.morphAttributes.normal=u),r&&(i.morphAttributes.color=d),i.morphTargetsRelative=!0,i})}function mS(i,e){if(i.updateMorphTargets(),e.weights!==void 0)for(let t=0,n=e.weights.length;t<n;t++)i.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){let t=e.extras.targetNames;if(i.morphTargetInfluences.length===t.length){i.morphTargetDictionary={};for(let n=0,s=t.length;n<s;n++)i.morphTargetDictionary[t[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function gS(i){let e,t=i.extensions&&i.extensions[st.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+Kh(t.attributes):e=i.indices+":"+Kh(i.attributes)+":"+i.mode,i.targets!==void 0)for(let n=0,s=i.targets.length;n<s;n++)e+=":"+Kh(i.targets[n]);return e}function Kh(i){let e="",t=Object.keys(i).sort();for(let n=0,s=t.length;n<s;n++)e+=t[n]+":"+i[t[n]]+";";return e}function yu(i){switch(i){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function _S(i){return i.search(/\.jpe?g($|\?)/i)>0||i.search(/^data\:image\/jpeg/)===0?"image/jpeg":i.search(/\.webp($|\?)/i)>0||i.search(/^data\:image\/webp/)===0?"image/webp":"image/png"}var xS=new De,vu=class{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new hS,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,s=!1,r=-1;typeof navigator<"u"&&(n=/^((?!chrome|android).)*safari/i.test(navigator.userAgent)===!0,s=navigator.userAgent.indexOf("Firefox")>-1,r=s?navigator.userAgent.match(/Firefox\/([0-9]+)\./)[1]:-1),typeof createImageBitmap>"u"||n||s&&r<98?this.textureLoader=new Ur(this.options.manager):this.textureLoader=new Sc(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new ko(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){let n=this,s=this.json,r=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(o){let a={scene:o[0][s.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:s.asset,parser:n,userData:{}};return Us(r,a,s),is(a,s),Promise.all(n._invokeAll(function(c){return c.afterRoot&&c.afterRoot(a)})).then(function(){e(a)})}).catch(t)}_markDefs(){let e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let s=0,r=t.length;s<r;s++){let o=t[s].joints;for(let a=0,c=o.length;a<c;a++)e[o[a]].isBone=!0}for(let s=0,r=e.length;s<r;s++){let o=e[s];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(n[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;let s=n.clone(),r=(o,a)=>{let c=this.associations.get(o);c!=null&&this.associations.set(a,c);for(let[l,h]of o.children.entries())r(h,a.children[l])};return r(n,s),s.name+="_instance_"+e.uses[t]++,s}_invokeOne(e){let t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){let s=e(t[n]);if(s)return s}return null}_invokeAll(e){let t=Object.values(this.plugins);t.unshift(this);let n=[];for(let s=0;s<t.length;s++){let r=e(t[s]);r&&n.push(r)}return n}getDependency(e,t){let n=e+":"+t,s=this.cache.get(n);if(!s){switch(e){case"scene":s=this.loadScene(t);break;case"node":s=this._invokeOne(function(r){return r.loadNode&&r.loadNode(t)});break;case"mesh":s=this._invokeOne(function(r){return r.loadMesh&&r.loadMesh(t)});break;case"accessor":s=this.loadAccessor(t);break;case"bufferView":s=this._invokeOne(function(r){return r.loadBufferView&&r.loadBufferView(t)});break;case"buffer":s=this.loadBuffer(t);break;case"material":s=this._invokeOne(function(r){return r.loadMaterial&&r.loadMaterial(t)});break;case"texture":s=this._invokeOne(function(r){return r.loadTexture&&r.loadTexture(t)});break;case"skin":s=this.loadSkin(t);break;case"animation":s=this._invokeOne(function(r){return r.loadAnimation&&r.loadAnimation(t)});break;case"camera":s=this.loadCamera(t);break;default:if(s=this._invokeOne(function(r){return r!=this&&r.getDependency&&r.getDependency(e,t)}),!s)throw new Error("Unknown type: "+e);break}this.cache.add(n,s)}return s}getDependencies(e){let t=this.cache.get(e);if(!t){let n=this,s=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(s.map(function(r,o){return n.getDependency(e,o)})),this.cache.add(e,t)}return t}loadBuffer(e){let t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[st.KHR_BINARY_GLTF].body);let s=this.options;return new Promise(function(r,o){n.load(ts.resolveURL(t.uri,s.path),r,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){let t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(n){let s=t.byteLength||0,r=t.byteOffset||0;return n.slice(r,r+s)})}loadAccessor(e){let t=this,n=this.json,s=this.json.accessors[e];if(s.bufferView===void 0&&s.sparse===void 0){let o=Yh[s.type],a=kr[s.componentType],c=s.normalized===!0,l=new a(s.count*o);return Promise.resolve(new Ot(l,o,c))}let r=[];return s.bufferView!==void 0?r.push(this.getDependency("bufferView",s.bufferView)):r.push(null),s.sparse!==void 0&&(r.push(this.getDependency("bufferView",s.sparse.indices.bufferView)),r.push(this.getDependency("bufferView",s.sparse.values.bufferView))),Promise.all(r).then(function(o){let a=o[0],c=Yh[s.type],l=kr[s.componentType],h=l.BYTES_PER_ELEMENT,u=h*c,d=s.byteOffset||0,f=s.bufferView!==void 0?n.bufferViews[s.bufferView].byteStride:void 0,m=s.normalized===!0,_,g;if(f&&f!==u){let p=Math.floor(d/f),v="InterleavedBuffer:"+s.bufferView+":"+s.componentType+":"+p+":"+s.count,x=t.cache.get(v);x||(_=new l(a,p*f,s.count*f/h),x=new Po(_,f/h),t.cache.add(v,x)),g=new Lo(x,c,d%f/h,m)}else a===null?_=new l(s.count*c):_=new l(a,d,s.count*c),g=new Ot(_,c,m);if(s.sparse!==void 0){let p=Yh.SCALAR,v=kr[s.sparse.indices.componentType],x=s.sparse.indices.byteOffset||0,S=s.sparse.values.byteOffset||0,P=new v(o[1],x,s.sparse.count*p),T=new l(o[2],S,s.sparse.count*c);a!==null&&(g=new Ot(g.array.slice(),g.itemSize,g.normalized));for(let R=0,F=P.length;R<F;R++){let M=P[R];if(g.setX(M,T[R*c]),c>=2&&g.setY(M,T[R*c+1]),c>=3&&g.setZ(M,T[R*c+2]),c>=4&&g.setW(M,T[R*c+3]),c>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}}return g})}loadTexture(e){let t=this.json,n=this.options,r=t.textures[e].source,o=t.images[r],a=this.textureLoader;if(o.uri){let c=n.manager.getHandler(o.uri);c!==null&&(a=c)}return this.loadTextureImage(e,r,a)}loadTextureImage(e,t,n){let s=this,r=this.json,o=r.textures[e],a=r.images[t],c=(a.uri||a.bufferView)+":"+o.sampler;if(this.textureCache[c])return this.textureCache[c];let l=this.loadImageSource(t,n).then(function(h){h.flipY=!1,h.name=o.name||a.name||"",h.name===""&&typeof a.uri=="string"&&a.uri.startsWith("data:image/")===!1&&(h.name=a.uri);let d=(r.samplers||{})[o.sampler]||{};return h.magFilter=Fp[d.magFilter]||_n,h.minFilter=Fp[d.minFilter]||Ki,h.wrapS=Bp[d.wrapS]||Ti,h.wrapT=Bp[d.wrapT]||Ti,s.associations.set(h,{textures:e}),h}).catch(function(){return null});return this.textureCache[c]=l,l}loadImageSource(e,t){let n=this,s=this.json,r=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(u=>u.clone());let o=s.images[e],a=self.URL||self.webkitURL,c=o.uri||"",l=!1;if(o.bufferView!==void 0)c=n.getDependency("bufferView",o.bufferView).then(function(u){l=!0;let d=new Blob([u],{type:o.mimeType});return c=a.createObjectURL(d),c});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");let h=Promise.resolve(c).then(function(u){return new Promise(function(d,f){let m=d;t.isImageBitmapLoader===!0&&(m=function(_){let g=new nn(_);g.needsUpdate=!0,d(g)}),t.load(ts.resolveURL(u,r.path),m,void 0,f)})}).then(function(u){return l===!0&&a.revokeObjectURL(c),u.userData.mimeType=o.mimeType||_S(o.uri),u}).catch(function(u){throw console.error("THREE.GLTFLoader: Couldn't load texture",c),u});return this.sourceCache[e]=h,h}assignTexture(e,t,n,s){let r=this;return this.getDependency("texture",n.index).then(function(o){if(!o)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(o=o.clone(),o.channel=n.texCoord),r.extensions[st.KHR_TEXTURE_TRANSFORM]){let a=n.extensions!==void 0?n.extensions[st.KHR_TEXTURE_TRANSFORM]:void 0;if(a){let c=r.associations.get(o);o=r.extensions[st.KHR_TEXTURE_TRANSFORM].extendTexture(o,a),r.associations.set(o,c)}}return s!==void 0&&(o.colorSpace=s),e[t]=o,o})}assignFinalMaterial(e){let t=e.geometry,n=e.material,s=t.attributes.tangent===void 0,r=t.attributes.color!==void 0,o=t.attributes.normal===void 0;if(e.isPoints){let a="PointsMaterial:"+n.uuid,c=this.cache.get(a);c||(c=new Do,Ln.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,c.sizeAttenuation=!1,this.cache.add(a,c)),n=c}else if(e.isLine){let a="LineBasicMaterial:"+n.uuid,c=this.cache.get(a);c||(c=new Ji,Ln.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,this.cache.add(a,c)),n=c}if(s||r||o){let a="ClonedMaterial:"+n.uuid+":";s&&(a+="derivative-tangents:"),r&&(a+="vertex-colors:"),o&&(a+="flat-shading:");let c=this.cache.get(a);c||(c=n.clone(),r&&(c.vertexColors=!0),o&&(c.flatShading=!0),s&&(c.normalScale&&(c.normalScale.y*=-1),c.clearcoatNormalScale&&(c.clearcoatNormalScale.y*=-1)),this.cache.add(a,c),this.associations.set(c,this.associations.get(n))),n=c}e.material=n}getMaterialType(){return ht}loadMaterial(e){let t=this,n=this.json,s=this.extensions,r=n.materials[e],o,a={},c=r.extensions||{},l=[];if(c[st.KHR_MATERIALS_UNLIT]){let u=s[st.KHR_MATERIALS_UNLIT];o=u.getMaterialType(),l.push(u.extendParams(a,r,t))}else{let u=r.pbrMetallicRoughness||{};if(a.color=new Ee(1,1,1),a.opacity=1,Array.isArray(u.baseColorFactor)){let d=u.baseColorFactor;a.color.setRGB(d[0],d[1],d[2],Ht),a.opacity=d[3]}u.baseColorTexture!==void 0&&l.push(t.assignTexture(a,"map",u.baseColorTexture,_t)),a.metalness=u.metallicFactor!==void 0?u.metallicFactor:1,a.roughness=u.roughnessFactor!==void 0?u.roughnessFactor:1,u.metallicRoughnessTexture!==void 0&&(l.push(t.assignTexture(a,"metalnessMap",u.metallicRoughnessTexture)),l.push(t.assignTexture(a,"roughnessMap",u.metallicRoughnessTexture))),o=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(e)}),l.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(e,a)})))}r.doubleSided===!0&&(a.side=Jt);let h=r.alphaMode||Zh.OPAQUE;if(h===Zh.BLEND?(a.transparent=!0,a.depthWrite=!1):(a.transparent=!1,h===Zh.MASK&&(a.alphaTest=r.alphaCutoff!==void 0?r.alphaCutoff:.5)),r.normalTexture!==void 0&&o!==rt&&(l.push(t.assignTexture(a,"normalMap",r.normalTexture)),a.normalScale=new se(1,1),r.normalTexture.scale!==void 0)){let u=r.normalTexture.scale;a.normalScale.set(u,u)}if(r.occlusionTexture!==void 0&&o!==rt&&(l.push(t.assignTexture(a,"aoMap",r.occlusionTexture)),r.occlusionTexture.strength!==void 0&&(a.aoMapIntensity=r.occlusionTexture.strength)),r.emissiveFactor!==void 0&&o!==rt){let u=r.emissiveFactor;a.emissive=new Ee().setRGB(u[0],u[1],u[2],Ht)}return r.emissiveTexture!==void 0&&o!==rt&&l.push(t.assignTexture(a,"emissiveMap",r.emissiveTexture,_t)),Promise.all(l).then(function(){let u=new o(a);return r.name&&(u.name=r.name),is(u,r),t.associations.set(u,{materials:e}),r.extensions&&Us(s,u,r),u})}createUniqueName(e){let t=xt.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){let t=this,n=this.extensions,s=this.primitiveCache;function r(a){return n[st.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(a,t).then(function(c){return kp(c,a,t)})}let o=[];for(let a=0,c=e.length;a<c;a++){let l=e[a],h=gS(l),u=s[h];if(u)o.push(u.promise);else{let d;l.extensions&&l.extensions[st.KHR_DRACO_MESH_COMPRESSION]?d=r(l):d=kp(new Lt,l,t),s[h]={primitive:l,promise:d},o.push(d)}}return Promise.all(o)}loadMesh(e){let t=this,n=this.json,s=this.extensions,r=n.meshes[e],o=r.primitives,a=[];for(let c=0,l=o.length;c<l;c++){let h=o[c].material===void 0?fS(this.cache):this.getDependency("material",o[c].material);a.push(h)}return a.push(t.loadGeometries(o)),Promise.all(a).then(function(c){let l=c.slice(0,c.length-1),h=c[c.length-1],u=[];for(let f=0,m=h.length;f<m;f++){let _=h[f],g=o[f],p,v=l[f];if(g.mode===Xn.TRIANGLES||g.mode===Xn.TRIANGLE_STRIP||g.mode===Xn.TRIANGLE_FAN||g.mode===void 0)p=r.isSkinnedMesh===!0?new nc(_,v):new ae(_,v),p.isSkinnedMesh===!0&&p.normalizeSkinWeights(),g.mode===Xn.TRIANGLE_STRIP?p.geometry=qh(p.geometry,Ac):g.mode===Xn.TRIANGLE_FAN&&(p.geometry=qh(p.geometry,Ho));else if(g.mode===Xn.LINES)p=new Lr(_,v);else if(g.mode===Xn.LINE_STRIP)p=new Pr(_,v);else if(g.mode===Xn.LINE_LOOP)p=new Ir(_,v);else if(g.mode===Xn.POINTS)p=new sc(_,v);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+g.mode);Object.keys(p.geometry.morphAttributes).length>0&&mS(p,r),p.name=t.createUniqueName(r.name||"mesh_"+e),is(p,r),g.extensions&&Us(s,p,g),t.assignFinalMaterial(p),u.push(p)}for(let f=0,m=u.length;f<m;f++)t.associations.set(u[f],{meshes:e,primitives:f});if(u.length===1)return r.extensions&&Us(s,u[0],r),u[0];let d=new it;r.extensions&&Us(s,d,r),t.associations.set(d,{meshes:e});for(let f=0,m=u.length;f<m;f++)d.add(u[f]);return d})}loadCamera(e){let t,n=this.json.cameras[e],s=n[n.type];if(!s){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?t=new en(Fr.radToDeg(s.yfov),s.aspectRatio||1,s.znear||1,s.zfar||2e6):n.type==="orthographic"&&(t=new $i(-s.xmag,s.xmag,s.ymag,-s.ymag,s.znear,s.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),is(t,n),Promise.resolve(t)}loadSkin(e){let t=this.json.skins[e],n=[];for(let s=0,r=t.joints.length;s<r;s++)n.push(this._loadNodeShallow(t.joints[s]));return t.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",t.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(s){let r=s.pop(),o=s,a=[],c=[];for(let l=0,h=o.length;l<h;l++){let u=o[l];if(u){a.push(u);let d=new De;r!==null&&d.fromArray(r.array,l*16),c.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[l])}return new ic(a,c)})}loadAnimation(e){let t=this.json,n=this,s=t.animations[e],r=s.name?s.name:"animation_"+e,o=[],a=[],c=[],l=[],h=[];for(let u=0,d=s.channels.length;u<d;u++){let f=s.channels[u],m=s.samplers[f.sampler],_=f.target,g=_.node,p=s.parameters!==void 0?s.parameters[m.input]:m.input,v=s.parameters!==void 0?s.parameters[m.output]:m.output;_.node!==void 0&&(o.push(this.getDependency("node",g)),a.push(this.getDependency("accessor",p)),c.push(this.getDependency("accessor",v)),l.push(m),h.push(_))}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c),Promise.all(l),Promise.all(h)]).then(function(u){let d=u[0],f=u[1],m=u[2],_=u[3],g=u[4],p=[];for(let v=0,x=d.length;v<x;v++){let S=d[v],P=f[v],T=m[v],R=_[v],F=g[v];if(S===void 0)continue;S.updateMatrix&&S.updateMatrix();let M=n._createAnimationTracks(S,P,T,R,F);if(M)for(let w=0;w<M.length;w++)p.push(M[w])}return new jn(r,void 0,p)})}createNodeMesh(e){let t=this.json,n=this,s=t.nodes[e];return s.mesh===void 0?null:n.getDependency("mesh",s.mesh).then(function(r){let o=n._getNodeRef(n.meshCache,s.mesh,r);return s.weights!==void 0&&o.traverse(function(a){if(a.isMesh)for(let c=0,l=s.weights.length;c<l;c++)a.morphTargetInfluences[c]=s.weights[c]}),o})}loadNode(e){let t=this.json,n=this,s=t.nodes[e],r=n._loadNodeShallow(e),o=[],a=s.children||[];for(let l=0,h=a.length;l<h;l++)o.push(n.getDependency("node",a[l]));let c=s.skin===void 0?Promise.resolve(null):n.getDependency("skin",s.skin);return Promise.all([r,Promise.all(o),c]).then(function(l){let h=l[0],u=l[1],d=l[2];d!==null&&h.traverse(function(f){f.isSkinnedMesh&&f.bind(d,xS)});for(let f=0,m=u.length;f<m;f++)h.add(u[f]);return h})}_loadNodeShallow(e){let t=this.json,n=this.extensions,s=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];let r=t.nodes[e],o=r.name?s.createUniqueName(r.name):"",a=[],c=s._invokeOne(function(l){return l.createNodeMesh&&l.createNodeMesh(e)});return c&&a.push(c),r.camera!==void 0&&a.push(s.getDependency("camera",r.camera).then(function(l){return s._getNodeRef(s.cameraCache,r.camera,l)})),s._invokeAll(function(l){return l.createNodeAttachment&&l.createNodeAttachment(e)}).forEach(function(l){a.push(l)}),this.nodeCache[e]=Promise.all(a).then(function(l){let h;if(r.isBone===!0?h=new Io:l.length>1?h=new it:l.length===1?h=l[0]:h=new Tt,h!==l[0])for(let u=0,d=l.length;u<d;u++)h.add(l[u]);if(r.name&&(h.userData.name=r.name,h.name=o),is(h,r),r.extensions&&Us(n,h,r),r.matrix!==void 0){let u=new De;u.fromArray(r.matrix),h.applyMatrix4(u)}else r.translation!==void 0&&h.position.fromArray(r.translation),r.rotation!==void 0&&h.quaternion.fromArray(r.rotation),r.scale!==void 0&&h.scale.fromArray(r.scale);return s.associations.has(h)||s.associations.set(h,{}),s.associations.get(h).nodes=e,h}),this.nodeCache[e]}loadScene(e){let t=this.extensions,n=this.json.scenes[e],s=this,r=new it;n.name&&(r.name=s.createUniqueName(n.name)),is(r,n),n.extensions&&Us(t,r,n);let o=n.nodes||[],a=[];for(let c=0,l=o.length;c<l;c++)a.push(s.getDependency("node",o[c]));return Promise.all(a).then(function(c){for(let h=0,u=c.length;h<u;h++)r.add(c[h]);let l=h=>{let u=new Map;for(let[d,f]of s.associations)(d instanceof Ln||d instanceof nn)&&u.set(d,f);return h.traverse(d=>{let f=s.associations.get(d);f!=null&&u.set(d,f)}),u};return s.associations=l(r),r})}_createAnimationTracks(e,t,n,s,r){let o=[],a=e.name?e.name:e.uuid,c=[];ns[r.path]===ns.weights?e.traverse(function(d){d.morphTargetInfluences&&c.push(d.name?d.name:d.uuid)}):c.push(a);let l;switch(ns[r.path]){case ns.weights:l=Pi;break;case ns.rotation:l=ai;break;case ns.position:case ns.scale:l=Li;break;default:switch(n.itemSize){case 1:l=Pi;break;case 2:case 3:default:l=Li;break}break}let h=s.interpolation!==void 0?dS[s.interpolation]:Rs,u=this._getArrayFromAccessor(n);for(let d=0,f=c.length;d<f;d++){let m=new l(c[d]+"."+ns[r.path],t.array,u,h);s.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(m),o.push(m)}return o}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){let n=yu(t.constructor),s=new Float32Array(t.length);for(let r=0,o=t.length;r<o;r++)s[r]=t[r]*n;t=s}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(n){let s=this instanceof ai?_u:Ic;return new s(this.times,this.values,this.getValueSize()/3,n)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}};function yS(i,e,t){let n=e.attributes,s=new hn;if(n.POSITION!==void 0){let a=t.json.accessors[n.POSITION],c=a.min,l=a.max;if(c!==void 0&&l!==void 0){if(s.set(new A(c[0],c[1],c[2]),new A(l[0],l[1],l[2])),a.normalized){let h=yu(kr[a.componentType]);s.min.multiplyScalar(h),s.max.multiplyScalar(h)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;let r=e.targets;if(r!==void 0){let a=new A,c=new A;for(let l=0,h=r.length;l<h;l++){let u=r[l];if(u.POSITION!==void 0){let d=t.json.accessors[u.POSITION],f=d.min,m=d.max;if(f!==void 0&&m!==void 0){if(c.setX(Math.max(Math.abs(f[0]),Math.abs(m[0]))),c.setY(Math.max(Math.abs(f[1]),Math.abs(m[1]))),c.setZ(Math.max(Math.abs(f[2]),Math.abs(m[2]))),d.normalized){let _=yu(kr[d.componentType]);c.multiplyScalar(_)}a.max(c)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}s.expandByVector(a)}i.boundingBox=s;let o=new Pn;s.getCenter(o.center),o.radius=s.min.distanceTo(s.max)/2,i.boundingSphere=o}function kp(i,e,t){let n=e.attributes,s=[];function r(o,a){return t.getDependency("accessor",o).then(function(c){i.setAttribute(a,c)})}for(let o in n){let a=xu[o]||o.toLowerCase();a in i.attributes||s.push(r(n[o],a))}if(e.indices!==void 0&&!i.index){let o=t.getDependency("accessor",e.indices).then(function(a){i.setIndex(a)});s.push(o)}return ft.workingColorSpace!==Ht&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${ft.workingColorSpace}" not supported.`),is(i,e),yS(i,e,t),Promise.all(s).then(function(){return e.targets!==void 0?pS(i,e.targets,t):i})}function Hp(i){let e=new Map,t=new Map,n=i.clone();return Gp(i,n,function(s,r){e.set(r,s),t.set(s,r)}),n.traverse(function(s){if(!s.isSkinnedMesh)return;let r=s,o=e.get(s),a=o.skeleton.bones;r.skeleton=o.skeleton.clone(),r.bindMatrix.copy(o.bindMatrix),r.skeleton.bones=a.map(function(c){return t.get(c)}),r.bind(r.skeleton,r.bindMatrix)}),n}function Gp(i,e,t){t(i,e);for(let n=0;n<i.children.length;n++)Gp(i.children[n],e.children[n],t)}var Vo=new A;function qn(i,e,t,n,s,r){let o=2*Math.PI*s/4,a=Math.max(r-2*s,0),c=Math.PI/4;Vo.copy(e),Vo[n]=0,Vo.normalize();let l=.5*o/(o+a),h=1-Vo.angleTo(i)/c;return Math.sign(Vo[t])===1?h*l:a/(o+a)+l+l*(1-h)}var Wt=class extends ut{constructor(e=1,t=1,n=1,s=2,r=.1){if(s=s*2+1,r=Math.min(e/2,t/2,n/2,r),super(1,1,1,s,s,s),s===1)return;let o=this.toNonIndexed();this.index=null,this.attributes.position=o.attributes.position,this.attributes.normal=o.attributes.normal,this.attributes.uv=o.attributes.uv;let a=new A,c=new A,l=new A(e,t,n).divideScalar(2).subScalar(r),h=this.attributes.position.array,u=this.attributes.normal.array,d=this.attributes.uv.array,f=h.length/6,m=new A,_=.5/s;for(let g=0,p=0;g<h.length;g+=3,p+=2)switch(a.fromArray(h,g),c.copy(a),c.x-=Math.sign(c.x)*_,c.y-=Math.sign(c.y)*_,c.z-=Math.sign(c.z)*_,c.normalize(),h[g+0]=l.x*Math.sign(a.x)+c.x*r,h[g+1]=l.y*Math.sign(a.y)+c.y*r,h[g+2]=l.z*Math.sign(a.z)+c.z*r,u[g+0]=c.x,u[g+1]=c.y,u[g+2]=c.z,Math.floor(g/f)){case 0:m.set(1,0,0),d[p+0]=qn(m,c,"z","y",r,n),d[p+1]=1-qn(m,c,"y","z",r,t);break;case 1:m.set(-1,0,0),d[p+0]=1-qn(m,c,"z","y",r,n),d[p+1]=1-qn(m,c,"y","z",r,t);break;case 2:m.set(0,1,0),d[p+0]=1-qn(m,c,"x","z",r,e),d[p+1]=qn(m,c,"z","x",r,n);break;case 3:m.set(0,-1,0),d[p+0]=1-qn(m,c,"x","z",r,e),d[p+1]=1-qn(m,c,"z","x",r,n);break;case 4:m.set(0,0,1),d[p+0]=1-qn(m,c,"x","y",r,e),d[p+1]=1-qn(m,c,"y","x",r,t);break;case 5:m.set(0,0,-1),d[p+0]=qn(m,c,"x","y",r,e),d[p+1]=1-qn(m,c,"y","x",r,t);break}}};var Os=class extends Tt{constructor(e=document.createElement("div")){super(),this.isCSS2DObject=!0,this.element=e,this.element.style.position="absolute",this.element.style.userSelect="none",this.element.setAttribute("draggable",!1),this.center=new se(.5,.5),this.addEventListener("removed",function(){this.traverse(function(t){t.element instanceof Element&&t.element.parentNode!==null&&t.element.parentNode.removeChild(t.element)})})}copy(e,t){return super.copy(e,t),this.element=e.element.cloneNode(!0),this.center=e.center,this}},zr=new A,Vp=new De,Wp=new De,Xp=new A,qp=new A,Dc=class{constructor(e={}){let t=this,n,s,r,o,a={objects:new WeakMap},c=e.element!==void 0?e.element:document.createElement("div");c.style.overflow="hidden",this.domElement=c,this.getSize=function(){return{width:n,height:s}},this.render=function(f,m){f.matrixWorldAutoUpdate===!0&&f.updateMatrixWorld(),m.parent===null&&m.matrixWorldAutoUpdate===!0&&m.updateMatrixWorld(),Vp.copy(m.matrixWorldInverse),Wp.multiplyMatrices(m.projectionMatrix,Vp),l(f,f,m),d(f)},this.setSize=function(f,m){n=f,s=m,r=n/2,o=s/2,c.style.width=f+"px",c.style.height=m+"px"};function l(f,m,_){if(f.isCSS2DObject){zr.setFromMatrixPosition(f.matrixWorld),zr.applyMatrix4(Wp);let g=f.visible===!0&&zr.z>=-1&&zr.z<=1&&f.layers.test(_.layers)===!0;if(f.element.style.display=g===!0?"":"none",g===!0){f.onBeforeRender(t,m,_);let v=f.element;v.style.transform="translate("+-100*f.center.x+"%,"+-100*f.center.y+"%)translate("+(zr.x*r+r)+"px,"+(-zr.y*o+o)+"px)",v.parentNode!==c&&c.appendChild(v),f.onAfterRender(t,m,_)}let p={distanceToCameraSquared:h(_,f)};a.objects.set(f,p)}for(let g=0,p=f.children.length;g<p;g++)l(f.children[g],m,_)}function h(f,m){return Xp.setFromMatrixPosition(f.matrixWorld),qp.setFromMatrixPosition(m.matrixWorld),Xp.distanceToSquared(qp)}function u(f){let m=[];return f.traverse(function(_){_.isCSS2DObject&&m.push(_)}),m}function d(f){let m=u(f).sort(function(g,p){if(g.renderOrder!==p.renderOrder)return p.renderOrder-g.renderOrder;let v=a.objects.get(g).distanceToCameraSquared,x=a.objects.get(p).distanceToCameraSquared;return v-x}),_=m.length;for(let g=0,p=m.length;g<p;g++)m[g].element.style.zIndex=_-g}}};var Ce=JSON.parse(document.getElementById("base-data").textContent),Oi=JSON.parse(document.getElementById("base-copy").textContent),Yp={en:{buttons:{now:"Skip to now"},settings:{follow:"Camera follows the action",on:"On",off:"Off",jump:"Jump to a moment of the history"},layers:{registry:"Enclave registry",product:"Product contract",bond:"Operator bond (USDC)"},zones:{provider:{title:"AI model gateway",body:"For the AI services, the enclave forwards your question over HTTPS to the model provider, RedPill, whose gateway runs in its own attested enclave. The enclave checks that gateway (Intel quote, production OS, pinned TLS) and refuses to call it if the check fails.",fact:"Model: gpt-oss-120b via tee.redpill.ai (README, 12 Nov 2026)"}}},fr:{buttons:{now:"Revenir \xE0 maintenant"},settings:{follow:"La cam\xE9ra suit l'action",on:"Oui",off:"Non",jump:"Aller \xE0 un moment de l'histoire"},layers:{registry:"Registre des enclaves",product:"Contrat du produit",bond:"Caution de l'op\xE9rateur (USDC)"},zones:{provider:{title:"Passerelle du mod\xE8le d'IA",body:"Pour les services d'IA, l'enclave transmet votre question en HTTPS au fournisseur du mod\xE8le, RedPill, dont la passerelle tourne dans sa propre enclave attest\xE9e. L'enclave v\xE9rifie cette passerelle (quote Intel, OS de production, TLS \xE9pingl\xE9) et refuse de l'appeler si la v\xE9rification \xE9choue.",fact:"Mod\xE8le : gpt-oss-120b via tee.redpill.ai (README, 12 nov. 2026)"}}}};function lm(i,e){for(let[t,n]of Object.entries(e))n&&typeof n=="object"&&!Array.isArray(n)?(i[t]=i[t]&&typeof i[t]=="object"?i[t]:{},lm(i[t],n)):i[t]==null&&(i[t]=n);return i}for(let i of Object.keys(Yp))Oi[i]=lm(Oi[i]||{},Yp[i]);var be=i=>document.querySelector(i),io=matchMedia("(prefers-reduced-motion: reduce)").matches,hm=location.origin+"/api",Zu=Ce.chain&&Ce.chain.explorer||"https://explorer.testnet.arc.io",us={get(i){try{return localStorage.getItem("archive-base."+i)}catch{return null}},set(i,e){try{localStorage.setItem("archive-base."+i,e)}catch{}}},Fi="en";Oi[Fi]||(Fi="en");var Zp=(i,e)=>e.split(".").reduce((t,n)=>t==null?t:t[n],i);function Z(i,e){let t=Zp(Oi[Fi],i);return t==null&&(t=Zp(Oi.en,i)),t==null?"":typeof t!="string"?t:e?t.replace(/\{(\w+)\}/g,(n,s)=>e[s]!=null?e[s]:n):t}var Yc=()=>Fi==="fr"?"fr-FR":"en-US",so=i=>Number(i).toLocaleString(Yc()),Qt=i=>Number(i).toLocaleString(Yc(),{maximumFractionDigits:4}),ds=i=>new Date(i*1e3).toLocaleString(Yc(),{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"UTC"})+" UTC",MS=i=>new Date(i*1e3).toLocaleDateString(Yc(),{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}),Vs=i=>i?Math.floor(Date.parse(i)/1e3):null,Nn=i=>i&&i.length>14?i.slice(0,6)+"\u2026"+i.slice(-4):i||"",SS=i=>Math.min(1,Math.max(0,i)),Ku=i=>1-Math.pow(1-i,3),Zc=i=>i<.5?4*i*i*i:1-Math.pow(-2*i+2,3)/2,ue=(i,e,t)=>new A(i,e,t),Wo=(()=>{let i=1234567;return()=>(i=i*16807%2147483647,(i-1)/2147483646)})(),Nt={live:"#34D399",session:"#5B8CFF",checking:"#FBBF24",fault:"#F87171",retired:"#7B8194",empty:"#3A4160"},jo={1:"#A78BFA",2:"#FFA034",3:"#38BDF8",4:"#F472B6",5:"#94A3B8",6:"#FCD34D",7:"#FBBF24"},Ys=be("#stage");function um(){be("#load-text").textContent=Z("errors.noWebgl")||"This device can't show the 3D room.";let i=be("#load-sub");i.textContent="";let e=document.createElement("a");e.href=hm.replace(/\/api$/,"")+"/console/#/ruche",e.textContent=Z("errors.noWebglLink")||"Open the console",e.style.color="var(--accent)",i.appendChild(e);let t=be("#load-bar");t&&t.parentElement&&(t.parentElement.hidden=!0)}if(!(()=>{try{let i=document.createElement("canvas");return!!(i.getContext("webgl2")||i.getContext("webgl"))}catch{return!1}})())throw um(),new Error("WebGL unavailable");var Un=(()=>{try{return new Co({canvas:Ys,antialias:!0,alpha:!0,powerPreference:"high-performance"})}catch(i){throw um(),i}})();Un.setClearColor(0,0);Un.outputColorSpace=_t;Un.toneMapping=ri;Un.shadowMap.enabled=!0;Un.shadowMap.type=Uh;var Me=new tc,At=new $i(-1,1,1,-1,.1,400),Kc=new Dc;Kc.domElement.className="labels";document.body.appendChild(Kc.domElement);var Du=Fr.degToRad(-32),Mu=Fr.degToRad(34),dm=ue(Math.sin(Du)*Math.cos(Mu),Math.sin(Mu),Math.cos(Du)*Math.cos(Mu)),ES=new yc(16052735,4864594,1.35),Bi=new Ns(16773340,2.1);Bi.position.set(-9,18,10);Bi.castShadow=!0;Bi.shadow.mapSize.set(2048,2048);Object.assign(Bi.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:1,far:60});Bi.shadow.camera.updateProjectionMatrix();Bi.shadow.bias=-5e-4;Bi.shadow.normalBias=.03;var fm=new Ns(10466559,.6);fm.position.set(10,6,-10);Me.add(ES,Bi,Bi.target,fm);var ui={},pm=new Lc;pm.register(i=>{let e=new Ur(i.options.manager);return e.setCrossOrigin(i.options.crossOrigin),i.textureLoader=e,{name:"archive_img_textures"}});async function bS(){let i=be("#load-bar"),e=["factory","station","shop","space","chars"].concat(Uu!=="code"?["racks"]:[]).map(n=>[n,`m/${n}.json`,`m/${n}/`]),t=0;await Promise.all(e.map(async([,n,s])=>{let r=await fetch(n);if(!r.ok)throw new Error(`${n} answered ${r.status}`);let o=await r.json();await Promise.all(Object.entries(o).map(async([a,c])=>{try{let l=Uint8Array.from(atob(c),h=>h.charCodeAt(0));ui[a]=await pm.parseAsync(l.buffer,s)}catch(l){console.warn("model failed",a,l)}})),t+=1,i.style.width=`${Math.round(t/e.length*100)}%`}));for(let[n,s]of Object.entries(ui))FS.includes(n)||s.scene.traverse(r=>{if(r.isMesh){r.castShadow=!0,r.receiveShadow=!0;for(let o of[].concat(r.material))o.metalness=0,(o.roughness==null||o.roughness<.6)&&(o.roughness=.9)}})}var Kp="data_center_rack";function pt(i,e,t,{rot:n=0,s=1,sy:r,y:o=0,parent:a=Me,shadow:c=!0,clone:l=!0}={}){if(!ui[i])return null;let h=l?ui[i].scene.clone(!0):ui[i].scene;h.position.set(0,0,0),h.updateMatrixWorld(!0);let u=new hn().setFromObject(h),d=u.getCenter(new A);h.position.set(-d.x,-u.min.y,-d.z);let f=new it;f.add(h),f.scale.set(s,r??s,s);let m=new it;return m.add(f),m.position.set(e,o,t),m.rotation.y=n,m.userData.size=u.getSize(new A).multiplyScalar(s),c||m.traverse(_=>{_.isMesh&&(_.castShadow=!1)}),a.add(m),m}var En=0,kc=Number(us.get("pace"))||1.5,ks=!1,zc=1,$u=()=>kc*(ks?80:zc),Xo=[],nt=i=>new Promise(e=>Xo.push({t:En+i/$u(),r:e})),Nc=[],on=(i,e,t=Zc)=>new Promise(n=>Nc.push({t:0,dur:Math.max(.001,i/$u()),fn:e,ease:t,r:n}));function wS(i){En+=i;for(let e=Xo.length-1;e>=0;e--)if(Xo[e].t<=En){let{r:t}=Xo[e];Xo.splice(e,1),t()}for(let e=Nc.length-1;e>=0;e--){let t=Nc[e];t.t+=i;let n=Math.min(1,t.t/t.dur);t.fn(t.ease(n)),n>=1&&(Nc.splice(e,1),t.r())}}var ct={hive:ue(.45,0,-1.1),gate:ue(-6.5,0,-3),pad:ue(-6,0,-.6),dish:ue(-3.4,1.4,-5.42),lab:ue(5.6,0,-4.2),dock:ue(6.3,0,4.3),author:ue(-6,0,3.9),provider:ue(8,.9,-.6)},ci={robot:ue(6.55,0,-4.12),screen:ue(6.55,0,-4.95),engine:ue(4.55,0,-4.55),vault:ue(5.35,0,-2.85)},$p=ue(-3.4,1.55,-5.3),TS=[],AS=[],Hc=null,Su=null,Sn,Jp=1/512;function RS(i,e,t,n){i.computeBoundingBox();let{min:s,max:r}=i.boundingBox,o=i.attributes.position,a=i.attributes.uv,c=r.y-s.y||1;for(let l=0;l<o.count;l++){let h=(o.getY(l)-s.y)/c;a.setXY(l,e*Jp,(n+(t-n)*h)*Jp)}return a.needsUpdate=!0,i}var CS={body:[48,390,506],light:[176,390,506],dark:[208,392,504],slate:[240,390,506],orange:[224,140,250],teal:[464,392,504]},Dn=(i,e)=>RS(i,...CS[e]);function PS(i,e,t){let n=ui[i]&&ui[i].scene;if(!n)return;n.updateMatrixWorld(!0);let s=new hn().setFromObject(n),r=s.getCenter(new A),o=new De().makeTranslation(-r.x,-s.min.y,-r.z);n.traverse(a=>{if(!a.isMesh)return;let c=o.clone().multiply(a.matrixWorld),l=new Hn(a.geometry,a.material,e.length);e.forEach((h,u)=>l.setMatrixAt(u,h.clone().multiply(c))),t&&t.forEach((h,u)=>l.setColorAt(u,h)),l.instanceMatrix.needsUpdate=!0,l.computeBoundingSphere(),l.receiveShadow=!0,l.castShadow=!1,Me.add(l)})}function LS(i,e,t){let n=new Is,s=-i/2,r=-e/2;return n.moveTo(s+t,r),n.lineTo(s+i-t,r),n.quadraticCurveTo(s+i,r,s+i,r+t),n.lineTo(s+i,r+e-t),n.quadraticCurveTo(s+i,r+e,s+i-t,r+e),n.lineTo(s+t,r+e),n.quadraticCurveTo(s,r+e,s,r+e-t),n.lineTo(s,r+t),n.quadraticCurveTo(s,r,s+t,r),n}function IS(){let i=[],e=[];for(let d=0;d<16;d++)for(let f=0;f<11;f++){let m=-7.5+d,_=-5+f,p=m>-2.6&&m<3.4&&_>-4.6&&_<2.6?(d+f)%2?.9:.87:(d+f)%2?1:.965;i.push(new De().makeTranslation(m,-.3,_)),e.push(new Ee(p,p,p))}PS("floor",i,e);let t=new ae(Dn(new Wt(16.7,.56,11.7,3,.16),"slate"),Sn);t.position.y=-.3-.28+.02,t.receiveShadow=!0,Me.add(t);for(let d=0;d<16;d++){let f=-7.5+d;pt(f===-6.5?"wall-door-wide":"wall",f,-5.65,{s:1,sy:2})}for(let d=0;d<7;d++){let f=-5+d;pt(f===-1?"wall-door-wide":"wall",8.15,f,{rot:-Math.PI/2,sy:2})}pt("conveyor-long",-6.5,-4.5,{rot:Math.PI/2}),pt("conveyor-long",-6.5,-2.5,{rot:Math.PI/2}),pt("conveyor",-6.5,-1,{rot:Math.PI/2});let n=pt("scanner-high",ct.gate.x,ct.gate.z,{rot:Math.PI/2});n&&(Uc=US(n)),pt("warning-traffic",-7.4,-2.55,{s:.72}),pt("skip",-5.3,-3.55),pt("indicator-special-lines",-6.5,.1,{y:.012,shadow:!1});for(let d of[-5.15,-4.05])pt("indicator-special-arrow",d,.2,{rot:Math.PI/2,y:.012,shadow:!1,s:.8});pt("hand-truck",-5.45,-.75,{rot:.7,s:1.3}),pt("shelf-boxes",-4.55,-5.05,{s:1.25}),pt("shelf-boxes",-1.9,-5.05,{s:1.25}),pt("container",-7.55,-1.55,{s:.85}),pt("container",-7.55,-.95,{s:.85}),Qr=new ae(new In(1.3,.95),new rt({color:"#FBBF24",transparent:!0,opacity:0,depthWrite:!1,side:Jt})),Qr.position.set(ct.gate.x,.9,ct.gate.z),Me.add(Qr),Kr=new it;let s=new ae(Dn(new Wt(.9,.42,.7,2,.06),"light"),Sn);s.position.y=.21,s.castShadow=!0;let r=new ae(Dn(new Wt(.94,.08,.74,2,.03),"orange"),Sn);r.position.y=.44,eo=new it,eo.position.y=.48,Kr.add(s,r,eo),Kr.position.set(-7.25,0,.85),Me.add(Kr);let o=new ae(Dn(new Wt(.7,1.2,.5,2,.04),"dark"),Sn);o.position.set(-3.4,.6,-5.15),o.castShadow=!0,Me.add(o);for(let d=0;d<4;d++){let f=new ae(new ut(.05,.035,.01),new rt({color:"#3BE596"}));f.position.set(-3.6+d*.12,.95,-4.895),Me.add(f)}Ui=em(2.4,.9,(d,f,m,_)=>tm(d,f,m,Z("status.block",{n:""}).trim().toUpperCase(),_,"ARC TESTNET"),!1),Ui.position.copy(ct.dish),Ui.position.z=-5.44,pt("cash-register",6.3,4.3,{rot:Math.PI,s:1.2}),pt("chair",6.3,3.25,{rot:Math.PI});let a=OS();a.position.set(7.75,0,3.55),a.rotation.y=-.75,un=new it;let c=new ae(Dn(new Wt(.62,.36,.5,2,.05),"light"),Sn);c.position.y=.18,c.castShadow=!0,un.add(c);let l=new ae(new ut(.64,.05,.52),new ht({color:"#5B8CFF"}));l.position.y=.3,un.add(l),un.userData.stack=new it,un.userData.stack.position.y=.4,un.add(un.userData.stack),un.position.set(7.55,0,2.35),Me.add(un),Zo=em(2.4,.9,(d,f,m,_)=>tm(d,f,m,"SETTLED ON ARC",_,"USDC \xB7 ARC TESTNET"),!1),Zo.position.set(7.98,1.45,.55),Zo.rotation.y=-Math.PI/2,pt("machine-window",ci.engine.x,ci.engine.z),pt("computer-system",ci.screen.x,ci.screen.z,{s:1.15}),pt("cables",5.6,-3.65,{s:.55,shadow:!1}),Ws=new ae(new pc(.5,16,12),new rt({color:"#8DB0FF",transparent:!0,opacity:0,depthWrite:!1})),Ws.position.copy(ci.engine).setY(.75),Me.add(Ws),zs=new it;let h=new ae(Dn(new Wt(.8,.5,.6,2,.06),"dark"),Sn);h.position.y=.25,h.castShadow=!0;let u=new ae(Dn(new Wt(.84,.08,.64,2,.03),"orange"),Sn);u.position.y=.36,Xs=new it,Xs.position.y=.52,zs.add(h,u,Xs),zs.position.copy(ci.vault),Me.add(zs),_m(ct.author.x,ct.author.z,0,{laptop:!0}),Su=new it,Su.position.copy(ct.provider),Me.add(Su)}var os=[[6.3,5.02],[5.4,5.3],[4.65,5.3],[3.9,5.3]],mm=[[1.25,4.4],[2.15,4.4]],jp=[-1.6,5.45],Qp=[2,5.3],DS=[[7.25,5.5],[8.15,5.55]],Ko=[3.98,.55],gm=[3.85,-.75],Nu=3.15,Zr=null,jr=null,Yo=null;function NS(){let i=new ht({color:"#C9D0DE",roughness:.3,metalness:.7}),e=new ht({color:"#C0394B",roughness:.7}),t=[3.45,4.25,5.05,5.8],n=[4.9,5.7],s=new Hn(new jt(.03,.03,.82,10).translate(0,.41,0),i,t.length*n.length),r=new Hn(new jt(.11,.12,.03,14).translate(0,.015,0),i,t.length*n.length),o=new Hn(new jt(.018,.018,1,8).rotateZ(Math.PI/2),e,(t.length-1)*n.length),a=0,c=0,l=new De;for(let m of n)t.forEach((_,g)=>{if(s.setMatrixAt(a,l.makeTranslation(_,0,m)),r.setMatrixAt(a,l.makeTranslation(_,0,m)),a++,g){let p=t[g-1];o.setMatrixAt(c++,new De().compose(ue((p+_)/2,.74,m),new tn,ue(_-p,1,1)))}});for(let m of[s,r,o])m.instanceMatrix.needsUpdate=!0,m.computeBoundingSphere(),m.castShadow=!0,Me.add(m);pt("pottedPlant",7.75,5.4,{s:1.6}),pt("rugRectangle",1.7,4.75,{s:1.3,shadow:!1});for(let[m,_]of mm)pt("bench",m,_-.06,{s:1.7});pt("pottedPlant",.45,4.3,{s:1.4}),jr=ue(6.95,1.02,3.7),Yo=ue(4.75,1.02,1.3),Zr=new Uo([jr.clone(),ue(6.95,2,3.7),ue(6.35,2.2,2.85),ue(5.15,2.2,1.65),ue(4.75,2,1.3),Yo.clone()],!1,"centripetal");let h=new ht({color:"#A8C6FF",emissive:new Ee("#2A4A8F"),transparent:!0,opacity:.5,roughness:.1,metalness:0,depthWrite:!1}),u=new ae(new gc(Zr,80,.08,14,!1),h);u.renderOrder=3,Me.add(u);for(let m of[.12,.3,.5,.7,.88]){let _=new ae(new mc(.092,.016,8,18),i);_.position.copy(Zr.getPointAt(m)),_.lookAt(_.position.clone().add(Zr.getTangentAt(m))),Me.add(_)}for(let m of[jr,Yo]){let _=new ae(new jt(.075,.1,.98,18),i);_.position.set(m.x,.49,m.z),_.castShadow=!0,Me.add(_);let g=new ae(new jt(.085,.085,.06,18),new rt({color:"#5B8CFF"}));g.position.set(m.x,.82,m.z),Me.add(g);let p=new ae(new jt(.16,.18,.04,20),i);p.position.set(m.x,.02,m.z),Me.add(p);let v=new ae(new jt(.09,.07,.08,14),i);v.position.set(m.x,1.03,m.z),Me.add(v)}_m(4.6,.55,-Math.PI/2);let d=new it;d.position.set(4.6,0,-.75),d.rotation.y=-Math.PI/2,Me.add(d);for(let m of[-.42,.42]){let _=new ae(new ut(.04,1.3,.42),sn.trim);_.position.set(m,.65,0),_.castShadow=!0,d.add(_)}let f=Object.keys(jo);[.32,.72,1.12].forEach((m,_)=>{let g=new ae(new ut(.84,.03,.42),sn.trim);g.position.set(0,m-.03,0),d.add(g);for(let p=0;p<3;p++){let v=f[(_*3+p)%f.length],x=new ae(new Wt(.22,.08,.3,2,.01),ym(v));x.position.set(-.26+p*.26,m+.04,0),x.castShadow=!0,d.add(x)}})}function _m(i,e,t,{laptop:n=!1,chairAt:s=[0,.62],s:r=1.45}={}){let o=new it;o.position.set(i,0,e),o.rotation.y=t,Me.add(o);let a=pt("desk",0,0,{s:r,parent:o}),c=a?a.userData.size.y:.55;return n?pt("laptop",0,-.02,{s:r*.62,y:c,parent:o}):(pt("computerScreen",-.25,-.16,{s:r,y:c,parent:o}),pt("computerScreen",.25,-.16,{s:r,y:c,parent:o})),pt("computerKeyboard",0,.14,{s:r,y:c,parent:o}),s&&pt("chairDesk",s[0],s[1],{s:r*.95,parent:o,rot:Math.PI}),o}function US(i){let e=null;return i.traverse(t=>{t.isMesh&&(e||(e=t.material.clone()),t.material=e)}),e}function OS(){let i=new it,e=new ae(Dn(new Wt(1.15,1.32,.08,2,.04),"body"),Sn);e.position.y=1.12,e.castShadow=!0;let t=new ae(Dn(new ut(.08,.5,.08),"dark"),Sn);t.position.y=.25;let n=new ae(Dn(new Wt(.5,.06,.32,2,.02),"orange"),Sn);n.position.y=.03;let s=document.createElement("canvas");s.width=560,s.height=640;let r=s.getContext("2d"),o=new Ls(s);o.colorSpace=_t,o.anisotropy=4,i.userData.redraw=()=>{r.clearRect(0,0,560,640),r.fillStyle="#23254A",r.fillRect(0,0,560,640),r.fillStyle="#FFB23E",r.font="800 64px Chivo, sans-serif",r.fillText("Services",40,92),r.fillStyle="#B9BEEE",r.font="500 32px Chivo, sans-serif",r.fillText(Fi==="fr"?"pay\xE9s \xE0 l'usage en USDC":"paid per use in USDC",40,140),[1,3,2,4].forEach((c,l)=>{let h=245+l*98;r.fillStyle=jo[c],r.beginPath(),r.arc(56,h-16,12,0,Math.PI*2),r.fill(),r.fillStyle="#FFFFFF",r.font="700 44px Chivo, sans-serif",r.fillText(Z(`products.${c}.short`),88,h)}),o.needsUpdate=!0};let a=new ae(new In(1.03,1.18),new rt({map:o}));return a.position.set(0,1.12,.042),i.add(e,t,n,a),Me.add(i),Ju.push(i),i}var Ju=[],$c=[];function ss(i,e){let t=document.createElement("div");t.className="zlabel",t.dataset.zone=i;let n=new Os(t);n.position.copy(e),Me.add(n),$c.push({key:i,el:t})}function em(i,e,t,n){let s=document.createElement("canvas");s.width=512,s.height=Math.round(512*e/i);let r=s.getContext("2d"),o=new Ls(s);o.colorSpace=_t,o.anisotropy=4;let a=new it,c=new ae(new Wt(i+.16,e+.16,.1,2,.04),new ht({color:"#2b3040",roughness:.8}));c.castShadow=!0;let l=new ae(new In(i,e),new rt({map:o}));if(l.position.z=.055,a.add(c,l),n){let u=new ae(new ut(.08,.95,.08),new ht({color:"#acb5c5"}));u.position.set(-i/2+.2,-e/2-.47,0);let d=u.clone();d.position.x=i/2-.2,a.add(u,d)}let h="";return a.userData.set=(u,...d)=>{u!==h&&(h=u,r.clearRect(0,0,s.width,s.height),t(r,s.width,s.height,...d),o.needsUpdate=!0)},Me.add(a),a}function tm(i,e,t,n,s,r){i.fillStyle="#12141c",i.fillRect(0,0,e,t),i.shadowColor="#ffac33",i.shadowBlur=14,i.fillStyle="#ffb347",i.font='700 30px "Chivo Mono", monospace',i.fillText(n,24,46),i.font='700 62px "Chivo Mono", monospace',i.fillText(s,24,116),r&&(i.shadowBlur=0,i.fillStyle="#c9a26a",i.font='500 22px "Chivo Mono", monospace',i.fillText(r,24,t-18))}var Ui,Zo,Uc,Qr,Ws,zs,Xs,un,Kr,eo,xm=[1.1,-1.1,-3.3],Oc=i=>.45+(i-2.5)*.72,Ft={w:.64,h:1.62,d:.78},Zs=i=>.3+i*.2,ro=3,bn=Ft.d/2,FS=["data_center_rack","server_rack"],BS={data_center_rack:{rotY:Math.PI/2,led:"Mat_2",glass:"Mat_1",inset:.06},server_rack:{rotY:-Math.PI/2,led:"ServerMaterial",glass:null,inset:-.02,fitW:.64}},Uu=(()=>{try{return new URLSearchParams(location.search).get("rack")||Kp}catch{return Kp}})(),Qn=null;function kS(i){let e=i.image,t=document.createElement("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0);let s=n.getImageData(0,0,t.width,t.height),r=s.data;for(let a=0;a<r.length;a+=4){let c=Math.max(r[a],r[a+1],r[a+2]);r[a]=r[a+1]=r[a+2]=c}n.putImageData(s,0,0);let o=new Ls(t);for(let a of["colorSpace","flipY","wrapS","wrapT","channel","rotation"])o[a]=i[a];return o.repeat.copy(i.repeat),o.offset.copy(i.offset),o.center.copy(i.center),o.needsUpdate=!0,o}function zS(){let i=BS[Uu],e=i&&ui[Uu];if(!e)return null;let t=e.scene.clone(!0),n=new it;n.rotation.y=i.rotY,n.add(t);let s=new it;s.add(n),s.updateMatrixWorld(!0);let r=new hn().setFromObject(s),o=r.getSize(new A),a=r.getCenter(new A),c=(Ft.h+.07)/o.y,l=i.fitW?i.fitW/o.x:c,h=new it,u=new it;u.add(s),h.add(u),s.position.set(-a.x,-r.min.y,-a.z),u.scale.set(l,c,l);let d=new ht({color:"#b8c8ea",transparent:!0,opacity:.26,roughness:.06,metalness:.25,depthWrite:!1,side:Jt}),f=null;h.traverse(_=>{_.isMesh&&(_.castShadow=!0,_.receiveShadow=!0,i.glass&&_.material.name===i.glass&&(_.material=d,_.castShadow=!1,_.renderOrder=2,_.userData.isGlass=!0),_.material.name===i.led&&(f=_.material))});let m=f&&f.emissiveMap?kS(f.emissiveMap):null;return HS(h),{t:h,spec:i,grey:m,size:new A(o.x*l,o.y*c,o.z*l)}}function HS(i){i.updateMatrixWorld(!0);let e=null;if(i.traverse(x=>{x.isMesh&&x.userData.isGlass&&(e=x)}),!e)return;let t=e.geometry.index?e.geometry.toNonIndexed():e.geometry.clone(),n=t.attributes.position,s=e.matrixWorld,r=new A,o=new Float32Array(n.count),a=-1/0;for(let x=0;x<n.count;x++)r.fromBufferAttribute(n,x).applyMatrix4(s),o[x]=r.z,a=Math.max(a,r.z);let c=[],l=[];for(let x=0;x<n.count;x+=3)(o[x]>a-.012&&o[x+1]>a-.012&&o[x+2]>a-.012?l:c).push(x);if(!l.length||!c.length)return;let h=x=>{let S=new Lt;for(let[P,T]of Object.entries(t.attributes)){let R=new Float32Array(x.length*3*T.itemSize),F=0;for(let M of x)for(let w=0;w<3;w++)for(let U=0;U<T.itemSize;U++)R[F++]=T.getComponent(M+w,U);S.setAttribute(P,new Ot(R,T.itemSize))}return S};e.geometry=h(c);let u=h(l);u.applyMatrix4(s),u.computeBoundingBox();let d=u.boundingBox;u.translate(-d.min.x,0,-d.max.z);let f=new it;f.name="rack-door",f.position.set(d.min.x,0,d.max.z);let m=new ae(u,e.material);m.renderOrder=2,f.add(m);let _=d.max.x-d.min.x,g=d.max.y-d.min.y,p=new ht({color:"#1b1e27",roughness:.5,metalness:.4});for(let[x,S,P,T]of[[_,.025,_/2,d.min.y+.012],[_,.025,_/2,d.max.y-.012],[.025,g,.012,(d.min.y+d.max.y)/2],[.025,g,_-.012,(d.min.y+d.max.y)/2]]){let R=new ae(new ut(x,S,.012),p);R.position.set(P,T,.004),f.add(R)}let v=new ae(new ut(.018,.16,.022),new ht({color:"#c7cede",roughness:.3,metalness:.7}));v.position.set(_-.045,(d.min.y+d.max.y)/2,.016),f.add(v),i.add(f)}function Qo(i,e){if(!i||!i.led)return;let t=e&&e!=="retired";i.led.emissive.set(e?Nt[e]||"#ffffff":"#000000"),i.led.emissiveIntensity=t?1.7:e==="retired"?.12:0,i.ledState=e||null}var fs=[];xm.forEach(i=>{for(let e=0;e<6;e++)fs.push({pos:ue(Oc(e),0,i),pod:null})});var Rt=new Map,ju=[],bt={},sn={};function Ou(i,e,t,n){let s=document.createElement("canvas");s.width=i,s.height=e,t(s.getContext("2d"),i,e);let r=new Ls(s);return r.colorSpace=_t,r.anisotropy=4,n&&(r.wrapS=r.wrapT=Ti,r.repeat.set(n[0],n[1])),r}function GS(){Qn=zS(),Qn&&(bn=Qn.size.z/2-Qn.spec.inset),bt.body=new Wt(Ft.w,Ft.h,Ft.d,2,.025).translate(0,Ft.h/2+.05,0),bt.top=new Wt(Ft.w+.03,.04,Ft.d+.03,1,.012).translate(0,Ft.h+.07,0),bt.kick=new ut(Ft.w-.06,.05,Ft.d-.06).translate(0,.025,0),bt.unit=new ut(.52,.17,.035),bt.bayHole=new In(.52,.17);let i=Ft.w-.02,e=Ft.h-.06,t=new Is;t.moveTo(0,0),t.lineTo(i,0),t.lineTo(i,e),t.lineTo(0,e),t.lineTo(0,0);let n=new Nr;n.moveTo(.045,.06),n.lineTo(i-.045,.06),n.lineTo(i-.045,e-.06),n.lineTo(.045,e-.06),n.lineTo(.045,.06),t.holes.push(n),bt.doorFrame=new uc(t,{depth:.022,bevelEnabled:!1}).translate(0,.08,0),bt.doorMesh=new In(i-.09,e-.12).translate(i/2,.08+e/2,.011),bt.handle=new ut(.022,.2,.03).translate(i-.03,.08+e*.55,.035),bt.led=new ut(.03,.022,.008),bt.bar=new ut(.5,.035,.03),bt.strip=new ut(.5,.04,.012),bt.module=new Wt(.5,.16,.42,2,.015),bt.moduleFace=new In(.44,.05),sn.body=new ht({color:"#262A37",roughness:.58,metalness:.22}),sn.trim=new ht({color:"#363C50",roughness:.5,metalness:.3}),sn.kick=new ht({color:"#15171F",roughness:.9}),sn.handle=new ht({color:"#AEB6C8",roughness:.35,metalness:.6}),sn.unit=new ht({color:"#FFFFFF",roughness:.6,metalness:.1,map:Ou(256,84,(s,r,o)=>{s.fillStyle="#9BA3B6",s.fillRect(0,0,r,o),s.fillStyle="#7E869A",s.fillRect(0,0,r,6),s.fillRect(0,o-6,r,6);for(let a=0;a<8;a++)s.fillStyle="#2B2F3C",s.fillRect(10+a*22,16,18,52),s.fillStyle="#5E667B",s.fillRect(12+a*22,20,14,4);s.fillStyle="#3B4152";for(let a=0;a<9;a++)s.fillRect(196+a%3*16,18+Math.floor(a/3)*18,10,10)})}),sn.bay=new rt({color:"#0B0D13"}),sn.mesh=new ht({color:"#FFFFFF",transparent:!0,roughness:.5,metalness:.3,side:Jt,depthWrite:!1,map:Ou(64,64,(s,r,o)=>{s.clearRect(0,0,r,o),s.fillStyle="rgba(32,36,48,0.92)",s.fillRect(0,0,r,o),s.globalCompositeOperation="destination-out";for(let[a,c]of[[16,16],[48,16],[0,48],[32,48],[64,48]])s.beginPath(),s.arc(a,c,11,0,Math.PI*2),s.fill()},[6,15])})}var Hr=null;function VS(){let i=[];for(let o of fs){let a=new it;if(a.position.copy(o.pos),Me.add(a),Qn){let g=Qn.t.clone(!0);g.traverse(p=>{!p.isMesh||p.material.name!==Qn.spec.led||(p.material=p.material.clone(),Qn.grey&&(p.material.emissiveMap=Qn.grey,p.material.needsUpdate=!0),o.led=p.material)}),a.add(g),o.cab=a,o.door=g.getObjectByName("rack-door")||null,o.doorK=0,o.ring={visible:!0},Qo(o,null);continue}let c=new ae(bt.body,sn.body);c.castShadow=!0,c.receiveShadow=!0;let l=new ae(bt.top,sn.trim);l.castShadow=!0;let h=new ae(bt.kick,sn.kick),u=new ae(bt.bayHole,sn.bay);u.position.set(0,Zs(ro),bn+.002);let d=new it;d.position.set(-Ft.w/2+.01,0,bn+.035);let f=new ae(bt.doorFrame,sn.trim);f.castShadow=!0;let m=new ae(bt.doorMesh,sn.mesh);m.renderOrder=2;let _=new ae(bt.handle,sn.handle);d.add(f,m,_),a.add(c,l,h,u,d),o.cab=a,o.door=d,o.doorK=0;for(let g=0;g<7;g++)g!==ro&&i.push(new De().makeTranslation(o.pos.x,Zs(g),o.pos.z+bn+.012));o.ring={visible:!0}}let e=new ht({color:"#E5B336",roughness:.55,metalness:.35}),t=new ht({color:"#2B3A5C",roughness:.8}),n=new ht({color:"#FFFFFF",roughness:.8,map:Ou(64,64,(o,a,c)=>{o.fillStyle="#B9BED3",o.fillRect(0,0,a,c),o.strokeStyle="#9AA0B8",o.lineWidth=2,o.strokeRect(1,1,a-2,c-2),o.fillStyle="#7C8299";for(let l=8;l<c;l+=8)for(let h=8;h<a;h+=8)o.beginPath(),o.arc(h,l,1.6,0,Math.PI*2),o.fill()},[6,1])}),s=Oc(0)-Ft.w/2-.1,r=Oc(5)+Ft.w/2+.1;for(let o of xm){let a=new ae(new ut(r-s,.05,.26),e);a.position.set((s+r)/2,1.9,o-.2),a.castShadow=!0,Me.add(a);let c=new ae(new jt(.06,.06,r-s,10).rotateZ(Math.PI/2),t);c.position.set((s+r)/2,1.95,o-.2),Me.add(c);for(let h=0;h<6;h++){let u=new ae(new jt(.02,.02,.2,6),t);u.position.set(Oc(h)-.15,1.82,o-.2),Me.add(u)}let l=new ae(new In(r-s,.62),n);l.rotation.x=-Math.PI/2,l.position.set((s+r)/2,.011,o+bn+.33),l.receiveShadow=!0,Me.add(l)}i.length&&(Hr=new Hn(bt.unit,sn.unit,i.length),i.forEach((o,a)=>Hr.setMatrixAt(a,o)),Hr.instanceMatrix.needsUpdate=!0,Hr.computeBoundingSphere(),Hr.receiveShadow=!0,Me.add(Hr))}function $o(i,e,t=.55){if(!i||!i.door)return Promise.resolve();let n=i.doorK,s=e?1:0,r=Qn?1.22:1.75;return on(t,o=>{i.doorK=n+(s-n)*o,i.door.rotation.y=-r*i.doorK})}var WS=new rt({color:16777215}),XS=new ht({color:"#F5C542",emissive:new Ee("#5a4300"),metalness:.6,roughness:.3}),Eu={};function ym(i){return Eu[i]||(Eu[i]=new ht({color:jo[i]||"#94A3B8",roughness:.45,metalness:.15})),Eu[i]}function Qu(i){let e=new it,t=new ae(bt.module,ym(i));t.castShadow=!0;let n=new ae(bt.moduleFace,new rt({color:"#FFFFFF"}));return n.position.set(0,0,.212),e.add(t,n),e.userData.face=n,e}function vm(i){let e=new it,t=Qu(i.product);t.position.set(0,Zs(ro),bn+.02-.21);let n=new Hn(bt.led,WS,6),s=new De,r=[0,1,2,4,5,6];for(let m=0;m<6;m++)n.setMatrixAt(m,s.makeTranslation(.205,Zs(r[m])+.035,bn+.032)),n.setColorAt(m,new Ee("#34365C"));n.instanceMatrix.needsUpdate=!0,n.computeBoundingSphere();let o=new ae(bt.bar,new rt({color:Nt.live}));o.position.set(0,Ft.h+.02,bn+.03);let a=new ae(bt.strip,new rt({color:jo[i.product]||"#94A3B8"}));a.position.set(0,.045,bn+.02);let c=new ae(new In(.6,.2),new rt({color:Nt.live,transparent:!0,opacity:.5,depthWrite:!1}));c.rotation.x=-Math.PI/2,c.position.set(0,.014,bn+.15);let l=new ae(new jt(.045,.05,.1,14),new rt({color:Nt.live}));l.position.set(.2,Ft.h+.14,.1);let h=new ae(new ut(.72,1.8,.86),new rt({visible:!1}));h.position.y=.9;let u=new ae(new jt(.07,.07,.015,20),XS);u.position.set(-.17,Ft.h+.098,.1),u.visible=!1,Qn&&(n.visible=!1),e.add(t,n,o,a,c,l,h,u),Me.add(e);let d=new rt({color:Nt.live}),f={id:i.id,info:i,grp:e,glow:c,beacon:l,bar:o,edgeMat:d,leds:n,strip:a,hit:h,module:t,vseal:u,state:"retired",socket:null,verified:!1,shown:!1,flash:0,mats:{}};return h.userData.pod=f,ju.push(h),e.visible=!1,f}var Hs={};for(let[i,e]of Object.entries(Nt))Hs[i]=new Ee(e);var Gc=new Ee("#2f3252");function Zn(i,e){i.state=e;let t=Hs[e]||Hs.retired,n=e!=="retired";i.bar.material.color.copy(n?t:Gc),i.glow.material.color.copy(t),i.glow.material.opacity=n?.62:0,i.beacon.material.color.copy(t),i.beacon.visible=n,i.strip.material.color.set(n?jo[i.info.product]||"#94A3B8":"#5b607a"),i.module.userData.face.material.color.set(n?t:"#4a4f66");for(let s=0;s<6;s++)i.leds.setColorAt(s,n?t:Gc);i.leds.instanceColor.needsUpdate=!0,i.socket&&Qo(i.socket,e)}function ed(i,e){i.socket=e,e.pod=i,Qo(e,i.state),i.grp.position.copy(e.pos),i.grp.scale.setScalar(1),i.grp.visible=!0,i.shown=!0}function Mm(){for(let i of Rt.values())i.grp.visible=!1,i.shown=!1,i.socket&&(i.socket.pod=null,Qo(i.socket,null)),i.socket=null}function qS(){let i=Ce.pods.slice(),e=i.filter(s=>s.active).sort((s,r)=>Number(s.product)-Number(r.product)),t=i.filter(s=>!s.active).sort((s,r)=>Date.parse(s.first)-Date.parse(r.first));for(;e.length+t.length>fs.length;){let s=t.findIndex(r=>!(r.fault||[]).length);if(s<0)break;t.splice(s,1)}let n=new Map;return[...e,...t].slice(0,fs.length).forEach((s,r)=>n.set(s.id,fs[r])),n}function YS(){let i=new Set(hi.values()),e=fs.find(r=>!i.has(r));if(e)return e;let t=Ce.pods.filter(r=>hi.has(r.id)&&!r.active&&!(r.fault||[]).length).sort((r,o)=>Date.parse(r.last||r.first)-Date.parse(o.last||o.first))[0];if(!t)return null;let n=hi.get(t.id);hi.delete(t.id);let s=Rt.get(t.id);return s&&(s.grp.visible=!1,s.shown=!1,s.socket=null),n.pod=null,Qo(n,null),n}var hi,bu=0,ZS=new Ee;function KS(i){if(bu+=i,!(bu<.12)){bu=0;for(let e of Rt.values())if(e.shown){if(e.vseal.visible=!!e.verified&&e.state!=="retired",e.socket&&e.socket.led){let t=e.socket.led;e.state==="live"||e.state==="session"?t.emissiveIntensity=1.35+Math.random()*.6:(e.state==="checking"||e.state==="fault")&&(t.emissiveIntensity=Math.floor(En*(e.state==="checking"?6:3))%2===0?1.8:.2)}if(e.state==="live"||e.state==="session"){for(let t=0;t<6;t++)Math.random()<.35&&e.leds.setColorAt(t,Math.random()<.75?Hs[e.state]:ZS.copy(Hs[e.state]).multiplyScalar(.4));e.leds.instanceColor.needsUpdate=!0}else if(e.state==="checking"||e.state==="fault"){let t=Math.floor(En*(e.state==="checking"?6:3))%2===0;for(let n=0;n<6;n++)e.leds.setColorAt(n,t?Hs[e.state]:Gc);e.leds.instanceColor.needsUpdate=!0,e.bar.material.color.copy(t?Hs[e.state]:Gc)}}}}var Jc=[];function $S(){["registry","product","bond"].forEach((i,e)=>{let t=5.6-e*.2,n=6.2-e*.2,s=LS(t,n,.35),r=new fc(s);r.rotateX(Math.PI/2);let o=new ae(r,new rt({color:"#5B8CFF",transparent:!0,opacity:0,depthWrite:!1,side:Jt}));o.renderOrder=10+e;let a=s.getPoints(8).map(f=>ue(f.x,0,f.y)),c=new Ir(new Lt().setFromPoints(a),new Ji({color:"#9DB7FF",transparent:!0,opacity:0}));c.renderOrder=20+e;let l=new it;l.add(o,c);let h=1.95+e*.36;l.position.set(ct.hive.x,h,ct.hive.z),Me.add(l);let u=document.createElement("div");u.className="layerlabel",u.style.opacity="0";let d=new Os(u);d.position.set(-t/2+.2,0,n/2-.3-e*.9),l.add(d),Jc.push({key:i,g:l,sheet:o,edge:c,y:h,lab:u,pulse:0})})}function Fs(i){let e=Jc.find(t=>t.key===i);e&&(e.pulse=1)}var Fu=0;function JS(i){for(let[e,t]of Jc.entries()){t.pulse=Math.max(0,t.pulse-i*.7);let n=Ku(SS((Fu-e*.15)/.7)),s=vt===4;t.g.position.y=Fr.lerp(t.y+8+e*1.5,t.y,s?n:1),t.sheet.material.opacity=(s?.2*n:0)+.2*t.pulse,t.edge.material.opacity=(s?.95*n:0)+.6*t.pulse,t.lab.style.opacity=String(s?n:Math.min(1,t.pulse*1.6))}}function oo(i,e,{r0:t=.3,r1:n=2.4,dur:s=1.1,y:r=.12}={}){let o=new ae(new dc(.9,1,48),new rt({color:e,transparent:!0,opacity:.9,depthWrite:!1,side:Jt}));return o.rotation.x=-Math.PI/2,o.position.copy(i).setY(r),Me.add(o),on(s,a=>{let c=t+(n-t)*a;o.scale.setScalar(c),o.material.opacity=.9*(1-a)},Ku).then(()=>{Me.remove(o),o.geometry.dispose(),o.material.dispose()})}function jS(i,e,t=1.2){let n=new jt(.05,.05,1,8,1,!0);n.translate(0,.5,0);let s=new ae(n,new rt({color:e,transparent:!0,opacity:.85,depthWrite:!1}));return s.position.copy(i),Me.add(s),on(t,r=>{s.scale.set(1,1+14*r,1),s.material.opacity=.85*(1-r)},Ku).then(()=>{Me.remove(s),n.dispose(),s.material.dispose()})}var QS=new jt(.11,.11,.16,6);function to(i){let e=new ae(QS,new ht({color:i,emissive:new Ee(i).multiplyScalar(.6),roughness:.4}));return e.castShadow=!0,Me.add(e),e}function as(i,e,t){let n=i.clone().lerp(e,.5);return n.y+=t,new Dr(i.clone(),n,e.clone())}function Gs(i,e,t,n=Zc){return on(t,s=>i.position.copy(e.getPoint(s)),n)}var Sm=new jt(.12,.12,.035,18),Vc=new ht({color:"#3d7bd6",emissive:new Ee("#1d4fa3").multiplyScalar(.5),roughness:.35}),Em=new ht({color:"#eaf1ff",roughness:.4});function rs(i,e,t=3,n=1.6){let s=[];for(let r=0;r<t;r++){let o=new ae(Sm,[Em,Vc,Vc]);o.castShadow=!0,o.position.copy(i),Me.add(o),s.push(nt(r*.12).then(()=>on(.9,a=>{o.position.copy(as(i,e,n).getPoint(a)),o.rotation.x=a*8},Zc)).then(()=>{Me.remove(o)}))}return Promise.all(s)}function Fc(i,e,t,n){let s=document.createElement("div");s.className="badge3d",s.textContent=e,s.style.background=t;let r=new Os(s);r.center.set(.5,1),r.position.copy(i),(n||Me).add(r),nt(2.7).then(()=>{r.removeFromParent()})}var Di=null,no=[];function eE(){Di=new Hn(new In(.08,.12),new rt({side:Jt}),120),Di.frustumCulled=!1,Di.count=0,Me.add(Di);let i=["#FFA034","#34D399","#5B8CFF","#F472B6","#FCD34D","#FFFFFF"];for(let e=0;e<120;e++)Di.setColorAt(e,new Ee(i[e%i.length]))}function bm(i){if(!io){for(let e=0;e<60;e++)no.push({p:i.clone().add(ue(0,.6,0)),v:ue((Wo()-.5)*3,3+Wo()*2.5,(Wo()-.5)*3),r:Wo()*6,life:1.6+Wo()*.6});for(;no.length>120;)no.shift()}}var nm=new De,im=new tn,sm=new Rr,tE=ue(1,1,1);function nE(i){if(!Di)return;let e=0;for(let t=no.length-1;t>=0;t--){let n=no[t];if(n.life-=i,n.life<=0){no.splice(t,1);continue}n.v.y-=9*i,n.v.multiplyScalar(.985),n.p.addScaledVector(n.v,i),n.r+=i*8,sm.set(n.r,n.r*.7,0),im.setFromEuler(sm),nm.compose(n.p,im,tE),Di.setMatrixAt(e++,nm)}Di.count=e,Di.instanceMatrix.needsUpdate=!0}var wm=[],li=class{constructor(e,t,n,s=0){let r=ui[e];if(this.ok=!!r,this.group=new it,this.group.userData.agent=!0,Me.add(this.group),this.pos=new se(t,n),this.heading=s,this.want=s,this.path=null,this.speed=.95,this.walked=0,this.carry=!1,!r)return;this.root=Hp(r.scene),this.root.traverse(l=>{l.isMesh&&(l.castShadow=!0,l.frustumCulled=!1)}),this.group.add(this.root),this.torso=this.root.getObjectByName("torso")||this.root,this.mixer=new bc(this.root),this.acts={};let o=l=>jn.findByName(r.animations,l),a=/^arm-(left|right)\./,c=(l,h,u)=>{if(!h)return;let d=this.mixer.clipAction(h);u&&(d.setLoop(Bh,1),d.clampWhenFinished=!0),this.acts[l]=d};for(let l of["idle","walk","interact-right","interact-left","sit"])c(l,o(l));for(let l of["pick-up","emote-yes","emote-no"])c(l,o(l),!0);o("walk")&&c("walk-legs",new jn("walk-legs",o("walk").duration,o("walk").tracks.filter(l=>!a.test(l.name)))),o("idle")&&c("idle-legs",new jn("idle-legs",o("idle").duration,o("idle").tracks.filter(l=>!a.test(l.name)))),o("holding-both")&&c("hold",new jn("hold",o("holding-both").duration,o("holding-both").tracks.filter(l=>a.test(l.name)))),this.base=null,this.baseKey="idle",this.setBase("idle",0),this.sync(),wm.push(this)}setBase(e,t=.22){if(!this.ok)return;this.baseKey=e;let n=this.carry&&(e==="walk"||e==="idle")?`${e}-legs`:e,s=this.acts[n];!s||s===this.base||(s.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(t).play(),this.base&&this.base.fadeOut(t),this.base=s)}setCarry(e){if(!this.ok||this.carry===e)return;this.carry=e;let t=this.acts.hold;t&&(e?t.reset().setEffectiveWeight(1).fadeIn(.18).play():t.fadeOut(.18));let n=this.baseKey;this.base=null;for(let s of[this.acts.walk,this.acts.idle,this.acts["walk-legs"],this.acts["idle-legs"]])s&&s.isRunning()&&s.fadeOut(.18);this.setBase(n,.18)}walk(e){return this.cancel(),this.path=e.map(t=>new se(t[0],t[1])),this.seg=0,this.walked=0,this.setBase("walk"),new Promise(t=>{this.done=t})}cancel(){if(this.done){let e=this.done;this.done=null,e(!1)}this.path=null}place(e,t,n){this.cancel(),this.pos.set(e,t),this.heading=this.want=n,this.setBase("idle",0),this.sync()}face(e){this.want=e}update(e){if(!this.ok)return;if(this.path){let n=this.speed*e*$u();for(;n>1e-6&&this.path;){let r=this.path[this.seg].clone().sub(this.pos),o=r.length();if(o<1e-4){if(this.seg+=1,this.seg>=this.path.length){this.path=null,this.setBase("idle");let c=this.done;this.done=null,c&&c(!0)}continue}let a=Math.min(n,o);r.divideScalar(o),this.pos.addScaledVector(r,a),this.walked+=a,n-=a,this.want=Math.atan2(r.x,r.y)}}let t=this.want-this.heading;t=Math.atan2(Math.sin(t),Math.cos(t)),this.heading+=t*(1-Math.exp(-e*10)),this.mixer.update(e*Math.min(kc,2)),this.sync()}sync(){this.group.position.set(this.pos.x,0,this.pos.y),this.group.rotation.y=this.heading}};function Bu(i){let e=document.createElement("div");e.className="bubble";let t=new Os(e);t.center.set(.5,1),t.position.set(0,1,0),i.group.add(t);let n=0;i.say=(s,r=2.4)=>{e.textContent=s,e.classList.add("on");let o=++n;nt(r).then(()=>{o===n&&e.classList.remove("on")})},i.hush=()=>{n+=1,e.classList.remove("on")}}var Qe,ot,di,yn,fi,xn,$r,rm=Ko,Yn=[],Jo=[],Wc=[],ku=()=>mm.find(i=>!Jo.some(e=>e.seat===i));function iE(i,e){i.seat=e,Jo.push(i),i.walk([[e[0],e[1]+.6],e]).then(t=>{t&&i.seat===e&&(i.face(0),i.setBase("sit",.25))})}function sE(){["character-male-d","character-female-a","character-male-b","character-female-c","character-male-e","character-male-f"].forEach((i,e)=>{let t=new li(i,Qp[0],Qp[1],Math.PI/2);if(Bu(t),t.speed=.85,!!t.ok)if(e<os.length)t.place(os[e][0],os[e][1],e===0?Math.PI:Math.PI/2),Yn.push(t);else if(ku()){let n=ku();t.place(n[0],n[1],0),t.seat=n,Jo.push(t),t.setBase("sit",0)}else t.group.visible=!1,Wc.push(t)}),yn=Yn[0]||new li("character-male-d",os[0][0],os[0][1],Math.PI),yn.say||Bu(yn)}function rE(){let i=Wc.shift(),e=ku();if(i){if(!e){Wc.push(i);return}i.place(jp[0],jp[1],Math.PI/2),i.group.visible=!0,iE(i,e)}}function td(){let i=Yn.shift();i&&(i.hush(),i.walk(DS).then(()=>{i.group.visible=!1,Wc.push(i),nt(5).then(rE)}),Yn.forEach((e,t)=>e.walk([os[t]]).then(n=>{n&&e.face(t===0?Math.PI:Math.PI/2)})),Yn[0]&&(yn=Yn[0]),nt(1.2).then(()=>{if(!Jo.length||Yn.length>=os.length)return;let e=Jo.shift();e.seat=null;let t=Yn.length;Yn.push(e),e.setBase("idle",.2),e.walk([[e.pos.x,e.pos.y+.6],os[t]]).then(n=>{n&&e.face(Yn.indexOf(e)===0?Math.PI:Math.PI/2)})}))}var cs={};function oE(){let i=new it,e=new ae(cs.body,Sn);e.position.y=.085,e.castShadow=!0;let t=new ae(cs.face,Sn);t.position.set(0,.085,.232);let n=new ae(cs.handle,Sn);n.position.set(-.17,.085,.245);let s=new ae(cs.led,new rt({color:"#FBBF24"}));return s.position.set(.15,.085,.244),i.add(e,t,n,s),i.userData.led=s,Me.add(i),i}var Tm=[],Am,Gr=null;function aE(){Sn=ui["conveyor-long"].scene.getObjectByProperty("isMesh",!0).material,cs.body=Dn(new Wt(.42,.16,.46,2,.03),"light"),cs.face=Dn(new ut(.38,.1,.012),"dark"),cs.handle=Dn(new ut(.035,.11,.03),"orange"),cs.led=new ut(.05,.035,.01),GS(),IS(),NS(),VS(),$S(),eE(),ss("pad",ue(-6.5,1.55,-.9)),ss("gate",ue(ct.gate.x,1.75,ct.gate.z)),ss("dish",ue(ct.dish.x,2.25,-5.3)),ss("hive",ue(ct.hive.x,1.9,2)),ss("dock",ue(5.3,1.5,3.85)),ss("noc",ue(4.45,1.75,-.1)),ss("lab",ue(5.5,1.75,-4.4)),ss("provider",ue(7.95,2.25,-1)),Qe=new li("character-worker",rm[0],rm[1],Math.PI/2),Qe.ok&&Qe.setBase("sit",0),ot=new li("character-female-f",-4.55,-4.35,Math.PI),di=new li("character-female-d",6.3,3.62,0),fi=new li("character-robot",ci.robot.x,ci.robot.z,Math.PI),xn=new li("character-female-e",3.3,4.75,Math.PI),$r=new li("character-male-a",ct.author.x,ct.author.z+.62,Math.PI);for(let e of[Qe,ot,di,fi,xn,$r])Bu(e);sE(),$r.ok&&$r.setBase("sit"),ot.ok&&ot.setBase("interact-left"),hi=qS();for(let e of Ce.pods)Rt.set(e.id,vm(e));for(let[e,t,n,s]of[["pad",ue(-6.4,0,-1.6),2.6,4.8],["gate",ue(ct.gate.x,0,ct.gate.z),2.2,1.6],["dish",ue(-3.4,0,-5),2.6,1.2],["lab",ue(5.6,0,-4),3.6,3.2],["dock",ue(5.6,0,4.6),4.6,2.6],["noc",ue(4.3,0,-.1),1.3,2.6],["author",ct.author,1.8,1.6],["provider",ue(7.85,0,-1),.8,1.6]]){let r=new ae(new ut(n,2.4,s),new rt({visible:!1}));r.position.copy(t).setY(1.1),r.userData.zone=e,Me.add(r),Tm.push(r)}let i=new ae(new ut(5.4,.4,6),new rt({visible:!1}));i.position.set(ct.hive.x,2.3,ct.hive.z),i.userData.zone="layers",Am=i,Me.add(i)}function ei(i,e,t=12){for(;i.children.length>Math.min(e,t);)i.remove(i.children[i.children.length-1]);for(;i.children.length<Math.min(e,t);){let n=i.children.length,s=new ae(Sm,[Em,Vc,Vc]);s.position.set((n%3-1)*.22,Math.floor(n/3)*.04,(n%2-.5)*.12),s.castShadow=!0,i.add(s)}}var wu=0;function cE(i){if(wu+=i,wu<2.2)return;wu=0;let e=Yn.slice(1).filter(n=>n.ok&&!n.path);if(!e.length||Math.random()<.45)return;let t=e[Math.floor(Math.random()*e.length)];t.face(Math.PI/2+(Math.random()<.5?-1:1)*(.5+Math.random()*.6)),nt(1.3+Math.random()).then(()=>{!t.path&&Yn.indexOf(t)>0&&t.face(Math.PI/2)})}var ze={};function Rm(){Object.assign(ze,{block:0,t:0,paid:0,sessionPaid:0,refunded:0,calls:0,callsUsdc:0,sessions:0,verdicts:0,bountyPool:0,bountiesPaid:0,bountyPaid:0,bondPosted:0,bondSlashed:0,bounties:new Map,openSessions:new Map,products:new Set})}Rm();function lE(){let i=0;for(let e of Rt.values())e.shown&&(e.state==="live"||e.state==="session")&&(i+=1);return i}function hE(){let i=0;for(let e of Rt.values())e.shown&&(i+=1);return i}function Cm(){Mm();for(let e of Ce.pods){let t=Rt.get(e.id),n=hi.get(e.id);if(!t||!n||Km(e))continue;ed(t,n);let s=(e.fault||[]).length>0;Zn(t,e.active?"live":s?"fault":"retired"),t.verified=e.level==="verified"}let i=Ce.stats;Object.assign(ze,{block:Number(i.head||Ce.chain.headBlock),t:Vs(Ce.capturedAt),paid:Number(i.settledUsdc)/1e6,sessionPaid:Number(i.sessionSettledUsdc)/1e6,refunded:Number(i.refundedUsdc)/1e6,calls:Number(i.x402Calls),callsUsdc:Number(i.x402SettledUsdc)/1e6,sessions:Number(i.sessions),verdicts:Number(i.verdicts),bountyPool:Number(i.bountyPool)/1e6,bountiesPaid:Number(i.bountiesPaid),bountyPaid:Number(i.bountyPaidUsdc)/1e6}),ei(Xs,Math.round(ze.bountyPool*4)),ei(eo,8),ei(un.userData.stack,0),$s()}var Pm={attest:"#34D399",pay:"#5B8CFF",session:"#5B8CFF",bounty:"#FFA034",fault:"#F87171",retire:"#7B8194",product:"#A78BFA",bond:"#FBBF24",level:"#FCD34D",verdict:"#34D399",admin:"#7B8194"},om=["ClaimRefuted","BountyPaid","ClaimAccepted","ExploitDelivered","SessionOpened","Settled","SessionClosed","CallSettled","EnclaveRegistered","EnclaveRetired","EnclaveInvalidated","Slashed","Bonded","BountyCreated","Recorded","ProofOfCloudToken","MachineAttested","ProductProposed","ProductActivated","WorkloadRetired","WorkloadAdded","WorkloadProposed","ProductUpdated","ProductUpdateProposed","ManifestURIUpdated","ManifestURIUpdateProposed","PolicyApplied","PolicyProposed","UnbondRequested","BondReserved","BondReleased","MachineBound","EnclaveImage","ExposureConsumed","AgentIdSet","SettlementProposed","SettlementAuthorized","CallerProposed","CallerAuthorized"];function Lm(){let i=Ce.timeline,e=[],t=null;i.forEach((n,s)=>{(!t||t.tx!==n.tx)&&(t={tx:n.tx,t:n.t,b:n.b,evs:[],idx:s},e.push(t)),t.evs.push(n)});for(let n of e)n.evs.sort((s,r)=>om.indexOf(s.n)-om.indexOf(r.n)),n.main=n.evs[0],n.pod=(n.evs.find(s=>s.e)||{}).e||(n.evs.find(s=>s.a&&s.a.signer)||{}).a?.signer||null;return e}var rn=[];function uE(i){let e=Ce.acts||[],t=-1;return e.forEach((n,s)=>{n.first!=null&&i>=n.first&&(t=s)}),t}var Bs=(i,e,t)=>i.evs.filter(n=>n.n===e).reduce((n,s)=>n+Number((s.a||{})[t]||0)/1e6,0);function tt(i,e){return Z("events."+i,e)||i}function Ks(i){return Z(`products.${i}.name`)||`#${i}`}async function Im(i,e={}){let t=i.main,n=i.pod?Rt.get(i.pod):null,s=(i.evs.find(c=>c.p)||{}).p,r={pod:n?Nn(n.id):i.pod?Nn(i.pod):"",product:s?Ks(s):"",n:"",amount:""};ze.t=i.t,ze.block=Math.max(ze.block,i.b);let o=!!e.fast,a=c=>e.camera!==!1?sd(c,n):null;switch(t.n){case"EnclaveRegistered":{let c=n&&!n.shown,l=!!n&&rn.find(h=>h.main.n==="EnclaveRegistered"&&h.pod===i.pod)===i;c?(a("noc"),Xt("attest",tt("register",r),i),await Um(n,o)):n&&(Xt("attest",tt(l?"register":"renew",r),i),await gE(n,o)),i.evs.some(h=>h.n==="MachineBound")&&n&&(n.verified=!0),Fs("registry");break}case"EnclaveInvalidated":case"EnclaveRetired":{if(n&&n.shown){let c=(t.a||{}).reason;Xt("retire",tt(t.n==="EnclaveRetired"?"retired":"invalidated",{...r,reason:c}),i),n.state!=="fault"&&Zn(n,"retired"),oo(n.grp.position,Nt.retired,{r1:1.4,dur:.9})}Fs("registry"),await nt(o?.35:1);break}case"CallSettled":{let c=Bs(i,"CallSettled","amount");ze.calls+=i.evs.filter(l=>l.n==="CallSettled").length,ze.callsUsdc+=c,ze.paid+=c,a("dock"),Xt("pay",tt("call_settled",{...r,amount:Qt(c)}),i),await Hu(n,{amount:c,ai:!0,fast:o});break}case"SessionOpened":{ze.sessions+=1;let c=Number((t.a||{}).deposit||0)/1e6;a("dock"),Xt("session",tt("session_opened",{...r,amount:Qt(c)}),i),yn.ok&&yn.setBase("interact-right"),await rs(ue(ct.dock.x-1.2,.5,ct.dock.z-.2),un.position.clone().setY(.5),4),ei(un.userData.stack,8);let l=n||[...Rt.values()].find(h=>h.shown&&h.info.product===String(t.p||s)&&h.state==="live");l&&(Zn(l,"session"),ze.openSessions.set((t.a||{}).sessionId,l)),yn.setBase("idle");break}case"Settled":{let c=Bs(i,"Settled","paidDelta");ze.paid+=c,ze.sessionPaid+=c;let l=ze.openSessions.get((t.a||{}).sessionId)||n;a("dock"),Xt("pay",tt("settled",{...r,amount:Qt(c)}),i),l&&await Hu(l,{amount:0,ai:!0,fast:o,rounds:2,leave:!1}),await rs(un.position.clone().setY(.5),ue(ct.pad.x,.6,ct.pad.z),3,2.6);break}case"SessionClosed":{let c=Number((t.a||{}).refund||0)/1e6;ze.refunded+=c;let l=ze.openSessions.get((t.a||{}).sessionId);Xt("session",tt("session_closed",{...r,amount:Qt(c)}),i),await rs(un.position.clone().setY(.5),ue(ct.dock.x-1.2,.5,ct.dock.z-.2),3),ei(un.userData.stack,0),l&&(l.state==="session"&&Zn(l,"live"),ze.openSessions.delete((t.a||{}).sessionId)),!o&&yn&&yn.ok&&td();let h=i.evs.find(u=>u.n==="Recorded");h&&l&&(ze.verdicts+=1,Fc(ue(0,1.95,0),`ERC-8004 \xB7 ${h.a.response}`,Number(h.a.response)>=50?Nt.live:Nt.fault,l.grp));break}case"BountyCreated":{let c=Number((t.a||{}).funding||0)/1e6;ze.bountyPool+=c,ze.bounties.set((t.a||{}).bountyId,{product:s,pool:c}),a("lab"),Xt("bounty",tt("bounty_created",{...r,amount:Qt(c)}),i),await rs(ue(ct.dock.x-1,.5,ct.dock.z-1),zs.position.clone().setY(.6),4,2.2),ei(Xs,Math.round(ze.bountyPool*4));break}case"ClaimAccepted":{a("lab"),Xt("bounty",tt("claim_accepted",r),i),await xE(n,o);break}case"BountyPaid":case"ExploitDelivered":{let c=Bs(i,"BountyPaid","amount");c&&(ze.bountiesPaid+=1,ze.bountyPaid+=c,ze.bountyPool=Math.max(0,ze.bountyPool-c*1.15)),a("lab"),i.evs.some(h=>h.n==="ExploitDelivered")&&Xt("bounty",tt("exploit_delivered",r),i),c&&(Xt("bounty",tt("bounty_paid",{...r,amount:Qt(c)}),i),fi.setBase("emote-yes"),fi.say(Z("events.bounty_paid",{...r,amount:Qt(c)}).split(".")[0]),await rs(zs.position.clone().setY(.6),ue(xn.pos.x,.8,xn.pos.y),4),ei(Xs,Math.round(ze.bountyPool*4)),bm(zs.position.clone()),xn.ok&&xn.walk([[4.9,-.9],[4.6,1.6],[3.3,4.75]]).then(h=>{h&&xn.face(Math.PI)}));let l=i.evs.find(h=>h.n==="Recorded");l&&n&&(ze.verdicts+=1,Fc(ue(0,1.95,0),`ERC-8004 \xB7 ${l.a.response}`,Nt.live,n.grp)),await nt(o?.3:1.2),fi.setBase("idle");break}case"ClaimRefuted":{a("lab"),Xt("fault",tt("claim_refuted",r),i),await yE(n,i,o),xn.ok&&xn.pos.y<0&&xn.walk([[4.9,-.9],[4.6,1.6],[3.3,4.75]]).then(c=>{c&&xn.face(Math.PI)});break}case"Bonded":{let c=Bs(i,"Bonded","amount");ze.bondPosted+=c,Xt("bond",tt("bond_posted",{...r,amount:Qt(c)}),i),Fs("bond"),await rs(ue(ct.pad.x,.8,ct.pad.z),Kr.position.clone().setY(.6),Math.min(5,Math.max(2,Math.round(c))),1.8),ei(eo,Math.min(12,Math.round(ze.bondPosted-ze.bondSlashed)));break}case"Slashed":{let c=Bs(i,"Slashed","amount");ze.bondSlashed+=c,Xt("fault",tt("slashed",{...r,amount:Qt(c)}),i),Fs("bond"),await nt(o?.3:.8);break}case"Recorded":{ze.verdicts+=i.evs.filter(l=>l.n==="Recorded").length;let c=Number((t.a||{}).response)>=50;Xt("verdict",tt(c?"verdict_ok":"verdict_bad",{...r,verdict:(t.a||{}).response}),i),n&&n.shown&&Fc(ue(0,1.95,0),`ERC-8004 \xB7 ${(t.a||{}).response}`,c?Nt.live:Nt.fault,n.grp),jS(Hc?Hc.position.clone().setY(2.6):ct.dish.clone(),c?Nt.live:Nt.fault,1),await nt(o?.3:1);break}case"ProofOfCloudToken":case"MachineAttested":case"PolicyApplied":case"PolicyProposed":{Xt("level",tt(t.n==="ProofOfCloudToken"?"poc_token":t.n==="MachineAttested"?"machine_bound":"policy",r),i),Fs("product"),i.evs.some(c=>c.n==="MachineAttested"||c.n==="ProofOfCloudToken")&&(a("gate"),await Om(o));for(let c of Rt.values())c.shown&&c.state==="live"&&oo(c.grp.position,"#FCD34D",{r1:1.2,dur:.8});await nt(o?.3:1.2);break}case"ProductProposed":case"ProductActivated":case"WorkloadRetired":case"WorkloadAdded":case"WorkloadProposed":case"ProductUpdated":case"ProductUpdateProposed":case"ManifestURIUpdated":case"ManifestURIUpdateProposed":{let c={ProductProposed:"product_proposed",ProductActivated:"product_activated",WorkloadRetired:"image_retired",WorkloadAdded:"image_allowed",WorkloadProposed:"image_proposed",ProductUpdated:"product_update",ProductUpdateProposed:"product_update",ManifestURIUpdated:"manifest_update",ManifestURIUpdateProposed:"manifest_update"}[t.n];Xt("product",tt(c,r),i),Fs("product"),$r.ok&&!o&&$r.say(Z("speech.publish"),1.4),await nt(o?.25:.9);break}default:{let c={BondReserved:"bond_reserved",BondReleased:"bond_released",UnbondRequested:"unbond",MachineBound:"machine_bound",ExposureConsumed:"exposure",EnclaveImage:"image"}[t.n]||"admin";(c==="bond_reserved"||c==="bond_released"||c==="unbond")&&Fs("bond"),c==="unbond"&&Xt("bond",tt(c,r),i),t.n==="MachineBound"&&n&&(n.verified=!0),await nt(o?.12:.35)}}$s()}var zu=Promise.resolve(),jc=new Error("scene superseded");function nd(){let i=ie.tok;return async e=>{let t=await e;if(i!==ie.tok)throw jc;return t}}function Dm(){zu=Promise.resolve();for(let i of fs)i.doorK=0,i.door&&(i.door.rotation.y=0);Qe.ok&&(Qe.setCarry(!1),Qe.place(Ko[0],Ko[1],Math.PI/2),Qe.setBase("sit",0)),ot.ok&&(ot.setCarry(!1),ot.place(-4.55,-4.35,Math.PI),ot.setBase("interact-left")),di.ok&&di.setBase("idle")}var Xc=i=>Z(`products.${i}.short`)||Ks(i),dE=i=>i.pos.z+bn+.38,fE=.36;function pE(i,e=gm){let t=dE(i);return[[Nu,e[1]],[Nu,t],[i.pos.x+fE,t]]}function mE(i){Qr&&(Qr.material.color.set(i),on(1,e=>{Qr.material.opacity=.5*Math.sin(e*Math.PI)},e=>e))}async function id(i,e,t){let n=to(e);n.position.copy(i),await Gs(n,as(n.position,$p,1.3),t?.3:.9),Me.remove(n),oo(ue($p.x,.02,-4.9),"#9DB7FF",{r1:1.2,dur:.8})}function qc(i,e,t){return on(t?.45:1.3,n=>i.position.copy(Zr.getPointAt(e?1-n:n)),Zc)}function Nm(i){let e=new ae(new jt(.045,.045,.13,12),new ht({color:i,emissive:new Ee(i).multiplyScalar(.35),roughness:.4}));return e.castShadow=!0,Me.add(e),e}async function Um(i,e){let t=hi.get(i.id);if(!t)return;let n=()=>{ed(i,t),Zn(i,"checking")},s=async()=>{await id(i.grp.position.clone().setY(Ft.h+.1),"#FBBF24",e),Zn(i,"live"),oo(t.pos,Nt.live,{r1:1.2,dur:.8})};if(e||!Qe.ok){n(),await s();return}let r=nd(),o=zu.then(async()=>{let a=null,c=null;try{await r(Promise.resolve()),a=Nm("#FFA034"),a.position.copy(jr),di.setBase("interact-right"),await r(qc(a,!1,!1)),Me.remove(a),a=null,di.setBase("idle"),Qe.face(Math.PI/2),Qe.say(Z("speech.start",{service:Xc(i.info.product)}),2.2),await r(nt(.6)),await r(Qe.walk([gm])),Qe.face(Math.PI/2),Qe.setBase("interact-right",.12),await r(nt(.45)),c=Qu(i.info.product),Me.add(c);let l=new A(Math.sin(Qe.heading),0,Math.cos(Qe.heading));c.position.set(Qe.pos.x+l.x*.27,.3,Qe.pos.y+l.z*.27),c.rotation.set(0,Qe.heading,0),c.scale.setScalar(.62),Qe.group.updateMatrixWorld(!0),Qe.torso.attach(c),Qe.setCarry(!0),Qe.setBase("idle",.15),await r(nt(.15));let h=pE(t);sd("hive",i),await r(Qe.walk(h)),Qe.face(Math.PI+.45),await r(nt(.25)),await r($o(t,!0)),Qe.setBase("interact-right",.15),await r(nt(.2)),Me.attach(c),Qe.setCarry(!1);let u=c.position.clone(),d=ue(t.pos.x,Zs(ro),t.pos.z+bn+.02-.21),f=c.rotation.y,m=c.scale.x;await r(on(.55,_=>{c.position.lerpVectors(u,d,_),c.rotation.y=f+(0-f)*_,c.scale.setScalar(m+(1-m)*_)})),Me.remove(c),c=null,n(),Qe.setBase("idle"),await r($o(t,!1,.45)),await r(s()),bm(t.pos.clone()),Qe.walk([...h.slice(0,-1).reverse(),[Nu,Ko[1]],Ko]).then(_=>{_&&(Qe.face(Math.PI/2),Qe.setBase("sit",.3))})}catch(l){if(l!==jc)throw l;a&&Me.remove(a),c&&c.removeFromParent(),Qe.setCarry(!1),Qe.setBase("idle"),di.setBase("idle")}});zu=o.catch(()=>{}),await o}async function gE(i,e){let t=i.state;Zn(i,"checking"),await id(i.grp.position.clone().setY(Ft.h+.1),"#FBBF24",e),Zn(i,t==="session"?"session":t==="fault"?"fault":"live"),oo(i.grp.position,Nt.live,{r1:1,dur:.6}),await nt(e?.05:.3)}async function Hu(i,e={}){let t=[];try{await _E(i,e,nd(),t)}catch(n){if(n!==jc)throw n;for(let s of t)Me.remove(s);di.setBase("idle")}}async function _E(i,{amount:e=0,ai:t=!1,fast:n=!1,rounds:s=1,leave:r=!0}={},o,a){let c=u=>(a.push(u),u),l=yn,h=i?i.info.product:null;l&&l.ok&&!n&&(l.face(Math.PI),l.say(Z("speech.ask",{service:h?Xc(h):"\u2026"}),2),l.setBase("interact-right")),di.setBase("interact-right"),await o(nt(n?.1:.9));for(let u=0;u<s;u++){let d=c(to("#5B8CFF"));d.position.copy(jr),await o(qc(d,!1,n));let f=i?i.grp.position.clone().add(ue(0,Zs(ro),bn+.08)):ct.hive.clone().setY(.8);if(await o(Gs(d,as(Yo,f,.6),n?.3:.8)),Me.remove(d),i)if(i.flash=1,t&&["1","3","4"].includes(i.info.product)){let _=c(to("#C4B5FD"));_.position.copy(f),await o(Gs(_,as(_.position,ct.provider.clone(),1.6),n?.35:.9)),await o(Gs(_,as(_.position,f.clone(),1.6),n?.35:.9)),Me.remove(_)}else await o(nt(n?.2:.6));let m=c(to("#34D399"));m.position.copy(f),await o(Gs(m,as(f,Yo,.6),n?.3:.8)),await o(qc(m,!0,n)),Me.remove(m)}di.setBase("idle"),l&&l.ok&&!n&&(l.setBase("idle"),l.say(Z("speech.thanks"),1.6)),e&&await o(rs(ue(6.3,.9,4.6),ue(Qe.pos.x,.8,Qe.pos.y),2,2.6)),r&&l&&l.ok&&!n&&(await o(nt(.6)),td())}async function xE(i,e){xn.ok&&await Promise.race([xn.walk([[3.6,3],[3.35,-2.6],[3.95,-3.35]]),nt(e?.6:5.5)]);let t=to("#F87171");t.position.set(xn.pos.x,.75,xn.pos.y),await Gs(t,as(t.position,ci.engine.clone().setY(.9),.8),e?.3:.8),Me.remove(t),fi.setBase("interact-right"),on(.5,n=>{Ws.material.opacity=.7*n}),i&&(i.flash=1),await nt(e?.5:2),on(.6,n=>{Ws.material.opacity=.7*(1-n)}),fi.setBase("idle")}async function yE(i,e,t){let n=[...Rt.values()].filter(s=>s.shown&&s.info.product===(i?i.info.product:"5")&&s!==i).slice(0,2);for(let s of n){let r=to("#9DB7FF");r.position.copy(s.grp.position).setY(1.5),Gs(r,as(r.position,ci.engine.clone().setY(1),1.6),t?.4:1.1).then(()=>Me.remove(r))}on(.5,s=>{Ws.material.opacity=.8*s}),await nt(t?.5:1.4),fi.setBase("emote-no"),fi.say(Z("events.claim_refuted",{pod:i?Nn(i.id):""}),2.4),on(.6,s=>{Ws.material.opacity=.8*(1-s)}),i&&(Zn(i,"fault"),oo(i.grp.position,Nt.fault,{r1:2,dur:1.2}),Fc(ue(0,1.95,0),"ERC-8004 \xB7 0",Nt.fault,i.grp),await rs(Kr.position.clone().setY(.6),ue(5.6,.6,3.9),2,2.6)),await nt(t?.3:1),fi.setBase("idle")}function vE(i){if(i==="dock"&&yn&&yn.ok&&(yn.face(Math.PI),yn.say(Z("speech.ask",{service:Xc("1")}),3.4)),i==="noc"&&Zr){let e=Nm("#FFA034");e.position.copy(jr),qc(e,!1,!1).then(()=>{Me.remove(e),Qe.ok&&Qe.say(Z("speech.start",{service:Xc("1")}),3.2)})}}async function Om(i){let e=nd(),t=null;try{if(t=oE(),t.position.set(-6.5,.4,-5.55),await e(on(i?.35:1.3,o=>{t.position.z=-5.55+2.55*o})),mE("#FCD34D"),Uc&&(Uc.emissive=new Ee("#FCD34D").multiplyScalar(.5),nt(1.2).then(()=>Uc.emissive.setScalar(0))),await e(id(ue(-6.5,1.2,-3),"#FCD34D",i)),t.userData.led.material.color.set("#FCD34D"),await e(on(i?.3:1,o=>{t.position.z=-3+2.15*o})),i||!ot.ok){t.removeFromParent();return}let n=[ot.pos.x,ot.pos.y];await e(ot.walk([[-5.2,-2.6],[-6.5,-.15]])),ot.face(Math.PI),ot.setBase("pick-up",.12),await e(nt(.3));let s=new A(Math.sin(ot.heading),0,Math.cos(ot.heading));t.position.set(ot.pos.x+s.x*.27,.27,ot.pos.y+s.z*.27),t.rotation.set(0,ot.heading,0),ot.group.updateMatrixWorld(!0),ot.torso.attach(t),ot.setCarry(!0),ot.setBase("idle",.15),await e(nt(.15)),sd("hive"),await e(ot.walk([[-4.2,-.2],[-2.2,0]])),ot.face(Math.PI/2),ot.setBase("interact-right",.15),await e(nt(.25)),Me.attach(t),ot.setCarry(!1);let r=t.position.clone();await e(on(.6,o=>{t.position.lerpVectors(r,ue(-1.6,.6,0),o),t.scale.setScalar(1-.9*o)})),t.removeFromParent(),ot.setBase("idle"),ot.walk([[-4.2,-.2],[-5.2,-2.6],n]).then(o=>{o&&(ot.face(Math.PI),ot.setBase("interact-left"))})}catch(n){if(n!==jc)throw n;t&&t.removeFromParent(),ot.ok&&(ot.setCarry(!1),ot.setBase("idle"))}}var ie={mode:"idle",i:0,tok:0,liveOk:!1,liveAt:0};function sd(i,e){if(!ie.follow||vt>=0||ks||us.get("follow")==="0")return;let t=e&&i==="hive"?e.id:i;if(t!==qu){if(En-Xu<2.2){let n=t;nt(2.2).then(()=>{ie.follow&&qu!==n&&En-Xu>=2.2&&dn(i,e)});return}dn(e&&i==="hive"?"pod":i,e)}}async function ao(i=0){let e=++ie.tok;ie.mode="replay",ie.follow=!0,cd(),(!qt||qt.kind!=="settings")&&pi(),il(Z("toasts.replayStart")),Rm(),Mm(),Dm(),rn[0]&&(ze.block=rn[0].b,ze.t=rn[0].t);for(let r of Rt.values())r.verified=!1,Zn(r,"retired");ei(Xs,0),ei(eo,0),ei(un.userData.stack,0),Jm();let t=Ce.acts||[],n=i>0&&t[i]&&t[i].first!=null?t[i].first:-1;ks=n>0;let s=-2;for(let r=0;r<rn.length;r++){if(e!==ie.tok)return;ie.i=r;let o=rn[r];ks&&o.idx>=n&&(ks=!1,vt<0&&dn("overview"));let a=uE(o.idx);if(a!==s&&a>=0&&(s=a,(Ce.acts[a]||{}).live&&bE(),kE(a,o.t),vt<0&&!ks&&await nt(1.2)),e!==ie.tok)return;nl(o.t);let c=!!((Ce.acts||[])[a]||{}).steady;c?(ie.steady=(ie.steady||0)+1,zc=ie.steady>3?8:1):(ie.steady=0,zc=1);let l=["admin","bond_reserved"].includes(o.main.n)||["SettlementAuthorized","SettlementProposed","CallerProposed","CallerAuthorized","AgentIdSet","ExposureConsumed","BondReserved","BondReleased","MachineBound","EnclaveImage"].includes(o.main.n);if(await Im(o,{fast:c||l,quiet:!1,camera:!l}),e!==ie.tok)return;await nt(c?.15:l?.1:.55)}e===ie.tok&&ea(!0)}function ea(i){ie.tok+=1,ie.mode="now",ie.follow=!1,ks=!1,zc=1,ie.steady=0;let e=ie.tok;zE(),i||Dm();let t=()=>{ie.mode!=="now"||e!==ie.tok||Ni||(Cm(),nl(Vs(Ce.capturedAt)),rd(),ie.liveOk&&ta())};t(),nt(2.5).then(t),nt(7).then(t),cd(),i&&il(Z("toasts.replayEnd")),vt<0&&dn("overview")}function rd(){Jm();for(let i of rn.slice(-4))Xt(i.main.k||"attest",jm(i),i)}var ME=Ce.chain&&Ce.chain.rpc||"https://rpc.testnet.arc.io",ls=Ce.live||{},wn=Ce.stack&&Ce.stack.name||"v2.1";function Fm(i,e){if(i&&typeof i.stack=="string"&&i.stack)return i.stack;let t=Number((i||{}).fromBlock),n=kt(e&&e.contracts&&e.contracts.sealedBountyVerified),s=kt((ls.contracts||{}).SealedBountyVerified);return ls.deployBlock&&t>=Number(ls.deployBlock)||n&&s&&n===s?ls.stack||"v3":wn}var Qc=()=>!!ie.liveStack&&ie.liveStack!==wn,Bm=(i,e)=>i==null?null:e===ls.stack&&e!==wn&&(ls.productKeys||{})[String(i)]||String(i),Gu=i=>i.stack||wn,od=i=>Qc()&&Gu(i)!==ie.liveStack,SE=i=>Z(Gu(i)===wn?"stacks.first":"stacks.live",{name:Gu(i)}),km=()=>Qc()?Z("status.liveStack",{name:ie.liveStack}):Z("status.live");function zm(i){if(!Qc())return;let e=new Set((i||[]).map(t=>kt(t.signer)));for(let t of Ce.pods)t.stack===ie.liveStack||e.has(kt(t.id))||(t.stack=wn,t.active&&(t.active=!1,t.status=`first stack (${wn})`))}function EE(i,e){!Qc()||(Ce.acts||[]).some(t=>t.live)||Ce.acts.push({title:Z("stacks.liveAct.title",{name:ie.liveStack}),story:Z("stacks.liveAct.story",{name:ie.liveStack,first:wn}),from:Vu(e),first:i,live:!0})}function bE(){for(let i of Rt.values())i.shown&&od(i.info)&&i.state!=="fault"&&Zn(i,"retired")}var wE={EnclaveRegistered:"attest",EnclaveImage:"attest",MachineBound:"attest",EnclaveInvalidated:"fault",EnclaveRetired:"retire",BondReserved:"bond",BondReleased:"bond",ExposureConsumed:"bond",Bonded:"bond",UnbondRequested:"bond",Slashed:"fault",CallSettled:"pay",Settled:"pay",BountyPaid:"pay",SessionOpened:"session",SessionClosed:"session",BountyCreated:"bounty",ClaimAccepted:"bounty",ExploitDelivered:"bounty",ClaimRefuted:"fault",Recorded:"verdict",MachineAttested:"level",ProofOfCloudToken:"level",PolicyProposed:"level",PolicyApplied:"level"},TE=(i,e)=>wE[e]||(i==="ProductRegistry"?"product":"admin"),kt=i=>String(i??"").toLowerCase(),Hm=i=>`${kt(i.tx)}:${Number(i.li)}`,Gm=new Set(Ce.timeline.map(Hm)),Vu=i=>Number(i)>0?new Date(Number(i)*1e3).toISOString().replace(/\.\d{3}Z$/,"Z"):null,Vm=()=>location.protocol!=="file:",AE=["SettlementAuthorized","SettlementProposed","CallerProposed","CallerAuthorized","AgentIdSet","ExposureConsumed","BondReserved","BondReleased","MachineBound","EnclaveImage"],qs=[],Ni=!1,Tu=!1,el=null,Wm=!1,Xm=0;function ad(i){i&&(Object.assign(Ce.stats,i),ie.mode==="now"&&Object.assign(ze,{paid:Number(i.settledUsdc)/1e6,sessionPaid:Number(i.sessionSettledUsdc)/1e6,refunded:Number(i.refundedUsdc)/1e6,calls:Number(i.x402Calls),callsUsdc:Number(i.x402SettledUsdc)/1e6,sessions:Number(i.sessions),verdicts:Number(i.verdicts),bountyPool:Number(i.bountyPool)/1e6,bountiesPaid:Number(i.bountiesPaid),bountyPaid:Number(i.bountyPaidUsdc)/1e6}))}function RE(i){let e=el;if(!ie.liveOk||!e)return"";let t=s=>so(Number(s||0)),n=s=>Qt(Number(s||0)/1e6);return Z(`zones.${i}.liveFact`,{enclaves:t(e.enclaves),active:t(e.enclavesActive),verdicts:t(e.verdicts),calls:t(e.x402Calls),sessions:t(e.sessions),settled:n(e.settledUsdc),bountiesPaid:t(e.bountiesPaid),bountyPaid:n(e.bountyPaidUsdc),refuted:t(e.claimsRefuted),slashed:n(e.bondSlashedUsdc),bonded:n(e.bondPostedUsdc),bounties:t(e.bounties),open:t(e.bountiesOpen),stack:ie.liveStack||wn})||""}async function ti(i,e=5e3){let t=await fetch(`${hm}/${i}`,{signal:AbortSignal.timeout(e),cache:"no-store"});if(!t.ok)throw new Error(`${i}: ${t.status}`);return t.json()}function tl(i){let e=kt(i);return e&&Ce.pods.find(t=>kt(t.id)===e)||null}function CE(i){let e=(Ce.bounties||[]).find(t=>String(t.id)===String(i));return e?String(e.productId):null}async function PE(i){let e=new Map,t=[...new Set(i)].slice(0,50);if(!t.length)return e;try{let n=t.map((o,a)=>({jsonrpc:"2.0",id:a,method:"eth_getBlockByNumber",params:["0x"+o.toString(16),!1]})),r=await(await fetch(ME,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(n),signal:AbortSignal.timeout(6e3)})).json();for(let o of Array.isArray(r)?r:[])o&&o.result&&o.result.timestamp&&e.set(t[o.id],parseInt(o.result.timestamp,16))}catch{}return e}async function qm(i){let e=Ce.timeline[Ce.timeline.length-1]||{b:0,t:Math.floor(Date.now()/1e3)},t=(i||[]).filter(r=>Number(r.block)>e.b&&!Gm.has(`${kt(r.tx)}:${Number(r.logIndex)}`)).sort((r,o)=>Number(r.block)-Number(o.block)||Number(r.logIndex)-Number(o.logIndex));if(!t.length)return[];let n=await PE(t.map(r=>Number(r.block))),s=Number((Ce.chain||{}).secPerBlock)||.5086;return t.map(r=>{let o={};for(let[f,m]of Object.entries(r.args||{}))(m==null||typeof m!="object")&&(o[f]=m);let a=Number(r.block),c=r.stack||ie.liveStack||wn,l=c===ls.stack&&c!==wn,h=o.productId!=null?Bm(o.productId,c):o.bountyId!=null?l?(ls.bountyProductKeys||{})[r.contract]||null:CE(o.bountyId):null,u=o.signer||null;if(!u&&r.name==="CallSettled"){let f=Ce.pods.find(m=>m.active&&String(m.product)===h&&kt(m.operator)===kt(o.operator)&&(m.stack||wn)===c);u=f?f.id:null}let d=u?tl(u):null;return d&&(u=d.id),{t:n.get(a)||Math.round(e.t+(a-e.b)*s),b:a,tx:r.tx,li:Number(r.logIndex),c:r.contract,n:r.name,k:TE(r.contract,r.name),p:h,e:u,a:o,live:!0,s:c}})}function Ym(i,e,t,n){let s=new Map((e&&e.enclaves||[]).map(r=>[kt(r.signer),r]));for(let r of i||[]){let o=s.get(kt(r.signer)),a=Vu(r.registeredAt),c=Vu(r.expiresAt),l=tl(r.signer);if(!l){l={id:r.signer,short:Nn(r.signer),product:Bm(r.productId,ie.liveStack),operator:r.operator,active:!!r.active,stack:ie.liveStack||wn,status:r.active?"active":"expired (registration not renewed)",fault:[],level:o?o.level:null,ppid:o?o.ppid:null,last:a,first:a,expires:c,regs:1,workload:Nn(String(r.workloadId||"")),bond:null,end:null,health:null,live:!0,pending:t&&!n?Date.now():0},t?LE(l):Ce.pods.push(l);continue}l.active=!!r.active,a&&(l.last=a),c&&(l.expires=c),o&&o.level&&(l.level=o.level),o&&o.ppid&&(l.ppid=o.ppid),r.active?l.status="active":l.status==="active"&&(l.status="expired (registration not renewed)")}}function Zm(i){for(let e of i){e.s&&e.s!==wn&&e.s===ie.liveStack&&EE(Ce.timeline.length,e.t),Ce.timeline.push(e),Gm.add(Hm(e));let t=e.e?tl(e.e):null;t&&(e.n==="EnclaveInvalidated"&&(t.status=`invalidated (${(e.a||{}).reason||"workload-retired"})`),e.n==="EnclaveRetired"&&(t.status="retired by its operator"),e.n==="EnclaveRegistered"&&(t.regs=Ce.timeline.filter(n=>n.n==="EnclaveRegistered"&&kt(n.e)===kt(t.id)).length))}}var Km=i=>!!i.pending&&Date.now()-i.pending<6e4;function LE(i){Ce.pods.push(i);let e=vm(i);Rt.set(i.id,e);let t=YS();return t&&hi.set(i.id,t),e}async function IE(){if(ie.liveOk=!1,!!Vm())try{let[i,e,t,n,s]=await Promise.all([ti("index",8e3),ti("stats",8e3),ti("enclaves",8e3),ti("levels",8e3).catch(()=>null),ti("activity?limit=100",8e3)]);if(ie.liveStack=Fm(i,n),Wm){ie.liveOk=!0,ie.liveHead=Number(i.head),ie.liveAt=performance.now(),ta({quiet:!0});return}zm(t),Ym(t,n,!1);let r=Ce.timeline[Ce.timeline.length-1],o=r&&Number(i.head)-r.b>1e3?(Date.now()/1e3-r.t)/(Number(i.head)-r.b):0;o>.1&&o<5&&(Ce.chain.secPerBlock=Number(o.toFixed(4)));let a=await qm(s);Zm(a),el=e,ad(e),ie.liveOk=!0,ie.liveHead=Number(i.head),ie.liveAt=performance.now()}catch(i){console.warn("ArcHive live data unavailable, showing the recorded state:",String(i&&i.message||i)),ie.liveOk=!1}}async function ta({quiet:i=!1}={}){if(!(!ie.liveOk||Tu)){Ni&&Date.now()-Xm>6e4&&(Ni=!1,qs.length=0),Tu=!0;try{let[e,t,n,s,r]=await Promise.all([ti("index"),ti("stats"),ti("enclaves"),ti("levels").catch(()=>null),ti("activity?limit=40")]);ie.liveHead=Number(e.head),ie.liveAt=performance.now(),ie.liveStack=Fm(e,s),zm(n),Ym(n,s,!0,i);let o=await qm(r);if(o.length){let a=Ce.timeline.length;Zm(o),rn=Lm(),ie.mode==="now"&&!i?(qs.push(...rn.filter(c=>c.idx>=a)),il(o.length===1?Z("toasts.liveNew1"):Z("toasts.liveNew",{n:o.length}))):ie.mode==="now"&&!Ni&&rd()}el=t,ad(t),ie.liveStamp=Date.now(),ie.mode==="now"&&(qs.length?NE():Ni||$m())}catch{}finally{Tu=!1}$s()}}var Au=!1;async function DE(){if(!(Au||ie.liveOk||!Vm())){Au=!0;try{let i=await ti("index",8e3);ie.liveOk=!0,ie.liveHead=Number(i.head),ie.liveAt=performance.now(),await ta({quiet:!0})}catch{}finally{Au=!1}}}async function NE(){if(!Ni){Ni=!0,Xm=Date.now();try{for(;qs.length;){if(ie.mode!=="now"||vt>=0){qs.length=0;break}let i=qs.shift(),e=i.pod?tl(i.pod):null;e&&(e.pending=0);let t=AE.includes(i.main.n);ie.follow=us.get("follow")!=="0"&&!qt,await Im(i,{fast:t,camera:!t}),await nt(t?.1:.6)}}finally{Ni=!1,ie.follow=!1}$m()}}function $m(){if(!(ie.mode!=="now"||Ni)){ad(el);for(let i of Ce.pods){let e=Rt.get(i.id);if(!e)continue;let t=hi.get(i.id);if(Km(i)||(t&&!e.shown&&ed(e,t),!t&&e.shown&&(e.grp.visible=!1,e.shown=!1),!e.shown))continue;let n=(i.fault||[]).length>0,s=i.active?e.state==="session"?"session":"live":n?"fault":"retired";e.state!==s&&Zn(e,s),e.verified=i.level==="verified"}nl(Math.floor(Date.now()/1e3)),$s()}}var at={target:ue(0,0,0),zoom:1,wantTarget:ue(0,0,0),wantZoom:1,baseHalf:10,par:new se,wantPar:new se},Wu={overview:{t:ue(.3,0,0),z:1},pad:{t:ue(-6,.5,-2),z:1.75},gate:{t:ue(-6.3,.7,-2.9),z:2.2},dish:{t:ue(-3.4,1,-4.6),z:2},hive:{t:ue(.45,.6,-1.1),z:1.55},layers:{t:ue(.45,1.9,-1.1),z:1.35},dock:{t:ue(4.7,.6,4),z:1.45},noc:{t:ue(3.6,.7,.4),z:1.7},lab:{t:ue(5.5,.6,-3.9),z:1.8},author:{t:ue(-6,.5,3.9),z:2},provider:{t:ue(7.3,1,-.8),z:2}},Xu=-10,qu="";function dn(i,e){if(i==="pod"&&e)at.wantTarget.copy(e.grp.position).setY(.45),at.wantZoom=2.6*(ps?1.2:1);else{let t=Wu[i]||Wu.overview;at.wantTarget.copy(t.t),at.wantZoom=t.z*(ps?1.2:1)}Xu=En,qu=i==="pod"&&e?e.id:i,io&&(at.target.copy(at.wantTarget),at.zoom=at.wantZoom)}var Yu=new A,UE=new A;function OE(){let i=[];for(let l of[-8.1,8.1])for(let h of[-6.1,6.1])for(let u of[-.9,2.2])i.push(ue(l,u,h));let e=Wu.overview.t;At.position.copy(e).addScaledVector(dm,80),At.up.set(0,1,0),At.lookAt(e),At.updateMatrixWorld(!0);let t=At.matrixWorldInverse,n=e.clone().applyMatrix4(t),s=0,r=0;for(let l of i){let h=l.clone().applyMatrix4(t).sub(n);s=Math.max(s,Math.abs(h.x)),r=Math.max(r,Math.abs(h.y))}let o=Jr/hs,a=(hs-(ps?200:170))/hs,c=ps?.98:.86;at.baseHalf=Math.max(r/a,s/o/c),At.getWorldDirection(Yu),Yu.cross(At.up).normalize(),UE.copy(At.up)}function FE(i){let e=io?1:1-Math.exp(-i*3.2);at.target.lerp(at.wantTarget,e),at.zoom+=(at.wantZoom-at.zoom)*e,at.par.lerp(at.wantPar,1-Math.exp(-i*4));let t=at.target.clone().addScaledVector(Yu,at.par.x).addScaledVector(ue(0,0,1).applyAxisAngle(ue(0,1,0),Du),-at.par.y);At.position.copy(t).addScaledVector(dm,80),At.lookAt(t);let n=Jr/hs,s=at.baseHalf;At.left=-s*n,At.right=s*n,At.top=s,At.bottom=-s,At.zoom=at.zoom;let r=vt>=0&&vt!==0&&vt!==7?ps?.24:.17:ps?.04:0;at.shift=(at.shift||0)+(r-(at.shift||0))*e;let o=s*at.shift*2/Math.max(.01,at.zoom);At.top-=o,At.bottom-=o,At.updateProjectionMatrix()}function BE(){document.documentElement.lang=Fi,document.querySelectorAll("[data-t]").forEach(i=>{i.textContent=Z(i.dataset.t)}),be("#btn-legend").setAttribute("aria-label",Z("buttons.legend")),be("#btn-about").setAttribute("aria-label",Z("buttons.about")),be("#btn-settings").setAttribute("aria-label",Z("buttons.settings")),be("#btn-find").setAttribute("aria-label",Z("buttons.find"));for(let i of $c)i.el.textContent=Z(`zones.${i.key}.title`)||i.key;for(let i of Jc)i.lab.textContent=Z(`layers.${i.key}`);Ui&&Ui.userData.set("");for(let i of Ju)i.userData.redraw();cd(),HE(),$s(),vt>=0&&co(vt),qt&&vn(qt.kind,qt.arg)}function $s(){let i=ze.block;ie.mode==="now"&&(i=ie.liveOk?ie.liveHead+Math.floor((performance.now()-ie.liveAt)/1e3/(Ce.chain&&Ce.chain.secPerBlock||.5086)):Number(Ce.stats.head||Ce.chain.headBlock)),be("#st-block").textContent=Z("status.block",{n:so(i||0)});let e=ie.mode==="now"?Ce.pods.length:hE();be("#st-pods").textContent=Z("status.pods",{live:lE(),total:e}),be("#st-paid").textContent=Z("status.paid",{usdc:Qt(ze.paid)}),be("#st-calls").textContent=Z("status.calls",{n:ze.calls}),be("#st-bounties").textContent=Z("status.bounties",{n:ie.mode==="replay"?ze.bounties.size:Number(Ce.stats.bounties),usdc:Qt(ze.bountyPool)}),be("#st-mode").classList.toggle("live",ie.liveOk&&ie.mode==="now"),be("#st-mode-text").textContent=ie.mode==="replay"?Z("status.replay",{date:MS(ze.t||Vs(Ce.capturedAt))}):ie.liveOk?km():Z("status.stale",{time:ds(Vs(Ce.capturedAt))}),Ui&&Ui.userData.set(String(i),so(i||0)),Zo&&Zo.userData.set(String(ze.paid),Qt(ze.paid))}function nl(i){be("#ticker-clock").textContent=i?ds(i):"",be("#act-clock").textContent=i?ds(i):""}function kE(i,e){let t=(Oi[Fi].acts||Oi.en.acts||[])[i]||Ce.acts[i]||{};be("#act-title").textContent=t.title||"",be("#act-story").textContent=t.story||"",nl(e),be("#act").classList.add("on")}function zE(){be("#act").classList.remove("on")}var qo=[];function Jm(){qo.length=0,be("#ticks").innerHTML=""}function Xt(i,e,t){if(!e)return;qo.unshift({kind:i,text:e,t:t?t.t:null,tx:t?t.tx:null,pod:t?t.pod:null}),qo.length>4&&qo.pop();let n=be("#ticks");n.innerHTML="";for(let s of qo){let r=document.createElement("div");r.className="tick";let o=document.createElement("i");o.style.background=Pm[s.kind]||"#A6AED0";let a=document.createElement("div"),c=document.createElement("button");c.type="button";let l=document.createElement("b");l.textContent=s.text,c.appendChild(l),c.addEventListener("click",()=>{let u=s.pod&&Rt.get(s.pod);u&&u.shown&&(ie.follow=!1,dn("pod",u),vn("pod",u.id))});let h=document.createElement("small");if(h.textContent=s.t?ds(s.t):"",s.tx&&s.t){let u=document.createElement("span");u.className="sep",u.textContent=" \xB7 ",h.appendChild(u)}if(s.tx){let u=document.createElement("a");u.href=`${Zu}/tx/${s.tx}`,u.target="_blank",u.rel="noopener",u.textContent=Nn(s.tx),h.appendChild(u)}a.append(c,h),r.append(o,a),n.appendChild(r)}}var am=0;function il(i){if(!i)return;let e=be("#toast");e.textContent=i,e.classList.add("on"),clearTimeout(am),am=setTimeout(()=>e.classList.remove("on"),4200)}function cd(){let i=be("#btn-replay"),e=ie.mode==="replay";i.querySelector(".txt").textContent=Z(e?"buttons.now":"buttons.replay"),i.setAttribute("aria-label",i.querySelector(".txt").textContent)}function HE(){let i=be("#stepper");i.innerHTML="";let e=Z("stepper")||[],t=["dock","dish","hive","pad"];e.forEach((n,s)=>{if(s){let o=document.createElement("i");o.textContent="\u203A",i.appendChild(o)}let r=document.createElement("button");r.type="button",r.textContent=n,r.addEventListener("click",()=>{ie.follow=!1,dn(t[s]),vn("zone",t[s]==="pad"?"pad":t[s]),i.querySelectorAll("button").forEach(o=>o.classList.toggle("on",o===r))}),i.appendChild(r)})}var GE={ProductProposed:"product_proposed",ProductActivated:"product_activated",WorkloadRetired:"image_retired",WorkloadAdded:"image_allowed",WorkloadProposed:"image_proposed",ProductUpdated:"product_update",ProductUpdateProposed:"product_update",ManifestURIUpdated:"manifest_update",ManifestURIUpdateProposed:"manifest_update",BondReserved:"bond_reserved",BondReleased:"bond_released",UnbondRequested:"unbond",MachineBound:"machine_bound",ExposureConsumed:"exposure",EnclaveImage:"image"};function jm(i){let e=i.main,t=e.a||{},n=(i.evs.find(o=>o.p)||{}).p,s={pod:i.pod?Nn(i.pod):"",product:n?Ks(n):"",amount:"",reason:t.reason,verdict:t.response},r=(o,a)=>Qt(Bs(i,o,a));switch(e.n){case"EnclaveRegistered":{let o=rn.find(a=>a.main.n==="EnclaveRegistered"&&a.pod&&kt(a.pod)===kt(i.pod));return tt(o===i?"register":"renew",s)}case"EnclaveInvalidated":return tt("invalidated",s);case"EnclaveRetired":return tt("retired",s);case"CallSettled":return tt("call_settled",{...s,amount:r("CallSettled","amount")});case"SessionOpened":return tt("session_opened",{...s,amount:Qt(Number(t.deposit||0)/1e6)});case"Settled":return tt("settled",{...s,amount:r("Settled","paidDelta")});case"SessionClosed":return tt("session_closed",{...s,amount:Qt(Number(t.refund||0)/1e6)});case"BountyCreated":return tt("bounty_created",{...s,amount:Qt(Number(t.funding||0)/1e6)});case"ClaimAccepted":return tt("claim_accepted",s);case"ExploitDelivered":case"BountyPaid":{let o=Bs(i,"BountyPaid","amount");return o?tt("bounty_paid",{...s,amount:Qt(o)}):tt("exploit_delivered",s)}case"ClaimRefuted":return tt("claim_refuted",s);case"Bonded":return tt("bond_posted",{...s,amount:r("Bonded","amount")});case"Slashed":return tt("slashed",{...s,amount:r("Slashed","amount")});case"Recorded":return tt(Number(t.response)>=50?"verdict_ok":"verdict_bad",s);case"ProofOfCloudToken":return tt("poc_token",s);case"MachineAttested":return tt("poc_token",s);case"PolicyApplied":case"PolicyProposed":return tt("policy",s);default:return tt(GE[e.n]||"admin",s)}}function Qm(i,e){let t=Te("div",{class:"row"}),n=Te("i");n.style.background=Pm[i.main.k]||"#A6AED0";let s=Te("div"),r=i.pod?Rt.get(i.pod):null,o=Te(e||!r?"span":"button",e||!r?{class:"what"}:{type:"button",class:"what"},jm(i));!e&&r&&o.addEventListener("click",()=>eg(r.id));let a=Te("small",{},ds(i.t));a.appendChild(Te("span",{class:"sep"}," \xB7 "));let c=Te("a",{href:`${Zu}/tx/${i.tx}`,target:"_blank",rel:"noopener"},Nn(i.tx)+" \u2197");return a.appendChild(c),s.append(o,a),t.append(n,s),t}function VE(i){let e=Rt.get(i.id),t=i.active?"live":(i.fault||[]).length?"fault":"retired",n=ie.mode==="replay"||!e?t:i.active&&e.state==="session"?"session":t,s=Te("div",{class:"row"}),r=Te("i");r.style.background=Nt[n]||"#7B8194";let o=Te("div"),a=Te("button",{type:"button",class:"what"},Z("pod.title",{short:Nn(i.id)}));a.addEventListener("click",()=>eg(i.id));let c=Z(`pod.statuses.${n==="retired"&&String(i.status||"").startsWith("expired")?"expired":n}`)||n;return o.append(a,Te("small",{},`${Ks(i.product)} \xB7 ${c}`)),s.append(r,o),s}function eg(i){let e=Rt.get(i);e&&(ie.follow=!1,e.shown&&dn("pod",e),vn("pod",i))}function WE(i){let e=Te("div",{class:"hist"}),t=rn.filter(s=>s.pod&&kt(s.pod)===kt(i.id));if(!t.length)return e;e.appendChild(Te("h3",{},`${Z("pod.history")} \xB7 ${t.length===1?Z("pod.historyCount1"):Z("pod.historyCount",{n:t.length})}`));let n=Te("div",{class:"rows"});for(let s of t.slice(-5).reverse())n.appendChild(Qm(s,!0));return e.appendChild(n),e}function XE(i,e){Xr(Z("find.title"));let t=Te("input",{type:"search",class:"find",placeholder:Z("find.placeholder"),"aria-label":Z("find.title"),autocomplete:"off",spellcheck:"false",enterkeyhint:"search"});t.value=e||"";let n=Te("div",{class:"found","aria-live":"polite"});i.append(t,Te("p",{class:"muted small"},Z("find.hint",{n:so(rn.length)})),n);let s=(o,a)=>{n.appendChild(Te("h3",{},o));let c=Te("div",{class:"rows"});for(let l of a)c.appendChild(l);n.appendChild(c)},r=()=>{let o=t.value.trim().toLowerCase();qt&&qt.kind==="find"&&(qt.arg=t.value),n.innerHTML="";let a=[],c=[];if(o){a=Ce.pods.filter(l=>[l.id,l.operator,l.ppid,Ks(l.product)].map(kt).join(" ").includes(o));for(let l=rn.length-1;l>=0&&c.length<8;l--){let h=rn[l];kt(h.tx).includes(o)&&c.push(h)}}else a=Ce.pods.filter(l=>l.active),c=rn.slice(-6).reverse();a.length&&s(Z(o?"find.racks":"find.live"),a.slice(0,8).map(VE)),c.length&&s(Z(o?"find.txs":"find.recent"),c.map(l=>Qm(l,!1))),!a.length&&!c.length&&n.appendChild(Te("p",{class:"muted"},Z("find.none")))};t.addEventListener("input",r),r(),matchMedia("(pointer: fine)").matches&&setTimeout(()=>t.focus({preventScroll:!0}),40)}var qt=null;function pi(){be("#panel").classList.remove("on"),qt=null}function Te(i,e={},t){let n=document.createElement(i);for(let[s,r]of Object.entries(e))n.setAttribute(s,r);return t!=null&&(n.textContent=t),n}function Xr(i){let e=be("#panel");e.innerHTML="";let t=Te("header"),n=Te("h2",{},i),s=Te("button",{class:"x",type:"button","aria-label":Z("buttons.close")},"\u2715");return s.addEventListener("click",pi),t.append(n,s),e.appendChild(t),e}function vn(i,e){qt={kind:i,arg:e};let t=be("#panel");if(i==="pod"){let n=Rt.get(e);if(!n)return;let s=n.info;Xr(Z("pod.title",{short:Nn(s.id)}));let r=n.state,o=Te("span",{class:"chip"},Z(`pod.statuses.${r==="retired"&&od(s)?"firstStack":r==="retired"&&s.status&&s.status.startsWith("expired")?"expired":r}`)||r);o.style.background=(Nt[r]||"#7B8194")+"33",o.style.color=Nt[r]||"#A6AED0",t.appendChild(o);let a=Te("dl",{class:"kv"}),c=(u,d,f)=>{a.appendChild(Te("dt",{},u));let m=Te("dd");f?m.appendChild(Te("code",{},d)):m.textContent=d,a.appendChild(m)};c(Z("pod.service"),Ks(s.product)),c(Z("pod.stack"),SE(s)),c(Z("pod.operator"),Nn(s.operator),!0),c(Z("pod.level"),s.level?Z(`pod.levels.${s.level}`)||s.level:"\u2014"),s.last&&c(Z("pod.checked"),ds(Vs(s.last))),s.expires&&c(Z("pod.valid"),ds(Vs(s.expires))),s.regs&&c(Z("pod.renewals"),String(s.regs)),s.workload&&c(Z("pod.fingerprint"),s.workload,!0),s.ppid&&c(Z("pod.machine"),Nn(s.ppid),!0),t.appendChild(a),t.appendChild(Te("p",{class:"muted"},(s.fault||[]).length?Z("pod.liar"):Z("pod.sealed")));let l=Z(`products.${s.product}.how`);l&&t.appendChild(Te("p",{class:"fact"},l)),t.appendChild(WE(s));let h=Te("a",{class:"link",href:`${Zu}/address/${s.id}`,target:"_blank",rel:"noopener"},Z("pod.explorer")+" \u2197");t.appendChild(h)}else if(i==="find")XE(t,e);else if(i==="zone"){Xr(Z(`zones.${e}.title`)||e),t.appendChild(Te("p",{},Z(`zones.${e}.body`)));let n=RE(e)||Z(`zones.${e}.fact`);n&&t.appendChild(Te("p",{class:"fact"},n))}else if(i==="legend"){Xr(Z("legend.title")),Z("legend.intro")&&t.appendChild(Te("p",{class:"muted"},Z("legend.intro")));let n=Te("ul",{class:"legend-list"});for(let r of Z("legend.states")||[]){let o=Te("li"),a=Te("i");a.style.background=Nt[r.key]||"#7B8194";let c=Te("div");c.append(Te("b",{},r.label),Te("span",{},r.hint)),o.append(a,c),n.appendChild(o)}t.appendChild(n);let s=Z("legend.notes")||[];if(s.length){let r=Te("ul",{class:"notes"});for(let o of s)r.appendChild(Te("li",{},o));t.appendChild(r)}}else if(i==="about")Xr(Z("about.title")),(Z("about.paras")||[]).forEach((n,s)=>t.appendChild(Te("p",{},ie.liveOk&&s===1?Z("about.liveReplay",{n:so(Ce.timeline.length)}):ie.liveOk&&s===2?Z("about.live"):n))),t.appendChild(Te("p",{class:"fact"},`${ie.liveOk?km():Z("status.stale",{time:ds(Vs(Ce.capturedAt))})} \xB7 ${Z("about.events",{n:so(Ce.timeline.length)})}`));else if(i==="settings"){Xr(Z("settings.title"));let n=(o,a,c,l,h)=>{let u=Te("div",{class:"field"});u.appendChild(Te("label",{},o));let d=Te("div",{class:"seg",role:"group","aria-label":o});for(let[f,m,_]of a){let g=Te("button",{type:"button","aria-pressed":String(f===c)},m);_&&(g.disabled=!0),g.addEventListener("click",()=>l(f)),d.appendChild(g)}u.appendChild(d),h&&u.appendChild(Te("small",{},h)),t.appendChild(u)};n(Z("settings.pace"),[[.75,"0.75\xD7"],[1.5,"1.5\xD7"],[3,"3\xD7"],[5,"5\xD7"]],kc,o=>{kc=o,us.set("pace",String(o)),vn("settings")}),n(Z("settings.mode"),[["replay",Z("settings.modeReplay")],["live",ie.liveOk?Z("settings.modeLive"):Z("buttons.now")]],ie.mode==="replay"?"replay":"live",o=>{o==="replay"?ao():ea(!1),vn("settings")},ie.liveOk?Z("settings.modeHint"):Z("toasts.noLive")),n(Z("settings.follow"),[["1",Z("settings.on")],["0",Z("settings.off")]],us.get("follow")==="0"?"0":"1",o=>{us.set("follow",o),vn("settings")});let s=Te("div",{class:"field"});s.appendChild(Te("label",{},Z("settings.jump")));let r=Te("div",{class:"seg"});(Oi[Fi].acts||Oi.en.acts||[]).forEach((o,a)=>{let c=Te("button",{type:"button"},`${a+1}. ${o.title}`);c.addEventListener("click",()=>{ao(a),pi()}),r.appendChild(c)}),s.appendChild(r),t.appendChild(s)}t.classList.add("on")}var qr=be("#tooltip");function qE(i,e,t){let n=i.state;qr.innerHTML="",qr.append(Te("b",{},`${Ks(i.info.product)}`),Te("span",{},`${Z(`pod.statuses.${n==="retired"&&od(i.info)?"firstStack":n}`)||n} \xB7 ${Nn(i.id)}`));let s=250;qr.style.left=`${Math.min(innerWidth-s-12,e+14)}px`,qr.style.top=`${Math.max(12,t-54)}px`,qr.classList.add("on")}function ld(){qr.classList.remove("on")}var vt=-1,YE=["overview","dock","noc","pod","layers","dish","lab","overview"];function tg(){pi(),ie.follow=!1,vt=0,co(0)}function co(i){let e=Z("tour")||[];if(i>=e.length){hd();return}vt=i;let t=e[i];be("#tour-title").textContent=t.title,be("#tour-body").textContent=t.body;let n=be("#tour-dots");n.innerHTML="",e.forEach((r,o)=>{let a=Te("i");o===i&&(a.className="on"),n.appendChild(a)}),be("#tour-skip").textContent=Z("buttons.skip"),be("#tour-back").textContent=Z("buttons.back"),be("#tour-back").hidden=i===0,be("#tour-next").textContent=i===e.length-1?Z("buttons.start"):Z("buttons.next"),be("#tour").classList.add("on"),be("#dim").classList.add("on");let s=YE[i]||"overview";if(s==="pod"){let r=[...Rt.values()].find(o=>o.shown&&o.info.product==="7"&&o.state==="live")||[...Rt.values()].find(o=>o.shown&&o.state==="live");r?(dn("pod",r),at.wantZoom*=1.3,Bc(r,!0)):(dn("hive"),Bc(null,!1))}else Bc(null,!1);s==="layers"&&(Fu=0,on(2.6,r=>{Fu=r},r=>r));for(let r of $c)r.el.classList.toggle("off",s!=="overview"&&r.key!==s);document.body.classList.toggle("tour-zone",s!=="overview"),s!=="pod"&&dn(s),vE(s)}function hd(i=!0){vt=-1,Bc(null,!1),be("#tour").classList.remove("on"),be("#dim").classList.remove("on");for(let e of $c)e.el.classList.remove("off");document.body.classList.remove("tour-zone"),us.set("tourDone","1"),be("#stepper").hidden=!1,dn("overview"),i?ie.mode!=="replay"?ao():ie.follow=!0:(ie.mode==="replay"&&ea(!1),il(Z("toasts.skipNow")))}var Vr=null;function ZE(i){let e=Qu(i),t=new ae(new ut(.42,.012,.34),new ht({color:"#1F8A70",roughness:.6}));t.position.set(0,.086,-.02);let n=new ae(new Wt(.15,.035,.15,2,.01),new ht({color:"#2B2F3C",roughness:.5}));n.position.set(-.06,.11,-.02);let s=new ae(new ut(.08,.006,.08),new rt({color:"#FFA034"}));s.position.set(-.06,.13,-.02);let r=new ut(.26,.12,.26),o=new ae(r,new rt({color:"#5B86FF",transparent:!0,opacity:.3,depthWrite:!1}));o.position.set(-.06,.15,-.02);let a=new Lr(new hc(r),new Ji({color:"#9DB7FF"}));return a.position.copy(o.position),e.add(t,n,s,o,a),e}function Bc(i,e){if(Vr&&(Vr.module.visible=!0,Vr.socket&&$o(Vr.socket,!1,.4)),Gr&&Gr.removeFromParent(),Vr=e?i:null,!i||!e)return;Gr=ZE(i.info.product),i.module.visible=!1,i.grp.add(Gr);let t=bn+.02-.21;Gr.position.set(0,Zs(ro),t),i.socket&&$o(i.socket,!0,.6),nt(.45).then(()=>{Vr===i&&on(1,n=>{Gr.position.z=t+.5*n})})}var Ru=new wc,cm=new se,Cu=null,Yr=null;function ng(i,e){cm.set(i/innerWidth*2-1,-(e/innerHeight)*2+1),Ru.setFromCamera(cm,At);let t=Ru.intersectObjects(ju.filter(s=>s.parent.visible),!1)[0];if(t)return{pod:t.object.userData.pod};let n=Ru.intersectObjects([...Tm,Am].filter(Boolean),!1)[0];return n?{zone:n.object.userData.zone}:null}var Pu=new A;function KE(i,e,t){let n=null,s=t;for(let r of ju){if(!r.parent.visible)continue;r.getWorldPosition(Pu).project(At);let o=Math.hypot((Pu.x+1)/2*innerWidth-i,(1-Pu.y)/2*innerHeight-e);o<s&&(s=o,n=r.userData.pod)}return n}Ys.addEventListener("pointermove",i=>{if(i.pointerType==="mouse"&&at.wantPar.set((i.clientX/innerWidth-.5)*(vt>=0||io?0:1.1),(i.clientY/innerHeight-.5)*(vt>=0||io?0:.9)),vt>=0)return;let e=ng(i.clientX,i.clientY);Ys.classList.toggle("hot",!!e),Cu=e&&e.pod?e.pod:null,Cu&&i.pointerType==="mouse"?qE(Cu,i.clientX,i.clientY):ld()});Ys.addEventListener("pointerleave",()=>{ld(),at.wantPar.set(0,0),Ys.classList.remove("hot")});Ys.addEventListener("pointerdown",i=>{Yr={x:i.clientX,y:i.clientY}});Ys.addEventListener("pointerup",i=>{if(!Yr||Math.hypot(i.clientX-Yr.x,i.clientY-Yr.y)>6){Yr=null;return}if(Yr=null,vt>=0)return;let e=ng(i.clientX,i.clientY);if(i.pointerType!=="mouse"){let t=KE(i.clientX,i.clientY,24);t&&(e={pod:t})}if(!e){pi();return}ie.follow=!1,e.pod?(dn("pod",e.pod),vn("pod",e.pod.id),ld()):e.zone&&(dn(e.zone==="layers"?"layers":e.zone),vn("zone",e.zone==="author"?"layers":e.zone))});addEventListener("keydown",i=>{if(i.key==="/"&&vt<0&&!/^(INPUT|TEXTAREA)$/.test(i.target&&i.target.tagName||"")){i.preventDefault(),vn("find","");return}i.key==="Escape"&&(vt>=0?hd():(pi(),dn("overview"))),vt>=0&&(i.key==="ArrowRight"||i.key==="Enter")&&(i.preventDefault(),co(vt+1)),vt>0&&i.key==="ArrowLeft"&&co(vt-1)});be("#btn-tour").addEventListener("click",tg);be("#tour-next").addEventListener("click",()=>co(vt+1));be("#tour-back").addEventListener("click",()=>co(Math.max(0,vt-1)));be("#tour-skip").addEventListener("click",()=>hd(!1));be("#btn-legend").addEventListener("click",()=>qt&&qt.kind==="legend"?pi():vn("legend"));be("#btn-about").addEventListener("click",()=>qt&&qt.kind==="about"?pi():vn("about"));be("#btn-settings").addEventListener("click",()=>qt&&qt.kind==="settings"?pi():vn("settings"));be("#btn-find").addEventListener("click",()=>qt&&qt.kind==="find"?pi():vn("find",""));be("#btn-replay").addEventListener("click",()=>{ie.mode==="replay"?ea(!1):ao()});function $E(){let i=be("#stars"),e=Math.min(2,devicePixelRatio||1);i.width=innerWidth*e,i.height=innerHeight*e;let t=i.getContext("2d");t.clearRect(0,0,i.width,i.height);let n=99,s=()=>(n=n*16807%2147483647,n/2147483647);for(let r=0;r<0;r++){let o=.25+s()*.65;t.fillStyle=`rgba(220,228,255,${o})`;let a=s()<.08?1.6:.9;t.fillRect(s()*i.width,s()*i.height,a*e,a*e)}}var Jr=innerWidth,hs=innerHeight,ps=!1;function ig(){Jr=innerWidth,hs=innerHeight,ps=Jr/hs<.9,Un.setPixelRatio(Math.min(devicePixelRatio||1,ps?1.6:2)),Un.setSize(Jr,hs,!1),Kc.setSize(Jr,hs),OE(),$E()}addEventListener("resize",ig);var ud=new Ec,Lu=0,Iu=0;function sg(){let i=Math.min(ud.getDelta(),.05);wS(i);for(let e of wm)e.update(i);io||cE(i);for(let e of TS)e.o.position.y=e.y+Math.sin(En*.6+e.ph)*.18;for(let e of AS){let t=En*e.sp+e.ph;e.o.position.set(Math.cos(t)*e.r,e.h+Math.sin(t*2)*.4,Math.sin(t)*e.r*.7-2),e.o.rotation.y=-t+(e.sp>0?0:Math.PI)}Hc&&(Hc.rotation.y=.95+Math.sin(En*.15)*.25);for(let e of Rt.values()){if(!e.shown)continue;e.flash=Math.max(0,e.flash-i*1.4);let t=e.state!=="retired",n=e.state==="checking"?.5+.5*Math.sin(En*10):e.state==="fault"?.5+.5*Math.sin(En*5):.85+.15*Math.sin(En*2+e.grp.position.x);e.glow.material.opacity=t?.4+.5*n:0,e.beacon.scale.setScalar(1+e.flash*.9)}JS(i),KS(i),nE(i),Lu+=i,Lu>.5&&(Lu=0,$s()),Iu+=i,Iu>20&&(Iu=0,ie.liveOk?ta():DE()),FE(i),Un.render(Me,At),Kc.render(Me,At)}document.addEventListener("visibilitychange",()=>{document.hidden?Un.setAnimationLoop(null):(ud.getDelta(),Un.setAnimationLoop(sg))});var Wr=be(".topcenter"),rg=be(".tools"),og=be(".topleft .brand");function dd(){let i=innerWidth;if(Wr.style.left="",Wr.style.top="",Wr.style.maxWidth="",i<=1100)return;let e=og.getBoundingClientRect().right+14,t=rg.getBoundingClientRect(),n=t.left-14,s=Math.min(560,i*.46);if(!(i/2-s/2>=e&&i/2+s/2<=n)){if(n-e>=380){Wr.style.left=`${Math.round((e+n)/2)}px`,Wr.style.maxWidth=`${Math.floor(Math.min(560,n-e))}px`;return}Wr.style.top=`${Math.round(t.bottom+10)}px`}}if("ResizeObserver"in window){let i=new ResizeObserver(()=>dd());i.observe(rg),i.observe(og)}addEventListener("resize",dd);dd();window.__base={scene:Me,camera:At,renderer:Un,pods:Rt,net:ze,director:ie,view:at,startReplay:ao,endReplay:ea,focus:dn,openPanel:vn,refreshLive:ta,liveQueue:qs,DATA:Ce,get BEATS(){return rn},get tourStep(){return vt},debug:{arrive:Um,serve:Hu,machineArrives:Om,clientLeaves:td,swingDoor:$o,PLAN:()=>hi,sockets:fs,crew:()=>Qe,client:()=>yn}};async function JE(){ig(),be("#load-text").textContent=Z("brand.name")||"ArcHive",await Promise.all([bS(),Promise.race([IE(),new Promise(i=>setTimeout(i,3500))])]),Wm=!0,aE(),rn=Lm(),Cm(),ie.mode="now",BE(),rd(),dn("overview"),at.target.copy(at.wantTarget),at.zoom=at.wantZoom,await document.fonts.ready,Ui&&(Ui.userData.set(""),$s());for(let i of Ju)i.userData.redraw();Un.compile(Me,At),be("#loader").classList.add("done"),ud.getDelta(),Un.setAnimationLoop(sg),us.get("tourDone")?ao():tg()}JE().catch(i=>{console.error(i),be("#load-text").textContent=Z("errors.models")||"The server room could not load its 3D models.",be("#load-sub").textContent=Z("errors.live")||"Reload the page to try again."});
/*! Bundled license information:

three/build/three.module.js:
  (**
   * @license
   * Copyright 2010-2023 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)
*/
