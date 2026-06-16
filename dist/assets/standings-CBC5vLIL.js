import"./modulepreload-polyfill-B5Qt9EMX.js";import"./firebase-auth-BOkAXTnI.js";import"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";import"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";import"https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";const S="https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2FTeam%20Inercia%20Casco%20REV2.png?alt=media&token=18016ad1-2185-48c6-a9e5-500f2a6fb9db",T=document.getElementById("leaderboard"),o=document.getElementById("category-select"),l=document.querySelector(".standings-dropdown"),d={nombre:2,team:4,genero:5,tiempo:7};let c=o?o.value:"ALL";function h(){l&&(c==="TEAM"?l.classList.add("team-selected"):l.classList.remove("team-selected"))}o&&o.addEventListener("change",()=>{c=o.value,h(),u()});h();function y(t){if(!t)return 1/0;const i=String(t).trim().split(":");if(i.length!==2)return 1/0;const n=Number(i[0]),m=Number(i[1]);return Number.isNaN(n)||Number.isNaN(m)?1/0:n*60+m}function I(t){return Number.isFinite(t)?t<=0?"LEADER":`+${t.toFixed(3)}`:"-"}async function u(){var t;try{if(!T)return;const i=await(await fetch("/api/standings")).json();if(!i.values)return;const n=[];i.values.forEach(e=>{const r=e[d.nombre],s=e[d.tiempo];if(!r||!String(r).trim()||!s||!String(s).trim())return;const a=String(e[d.team]||"").trim().toUpperCase(),g=String(e[d.genero]||"").trim().toUpperCase(),b=a==="TEAM";if(c==="M"&&g!=="M"||c==="F"&&g!=="F"||c==="TEAM"&&!b)return;const v=String(r).trim(),E=b?`
          <img
            src="${S}"
            class="driver-tag-icon"
            alt="Team Inercia">
          ${v}
        `:v;n.push({nombreFinal:E,tiempo:String(s).trim(),parsedTime:y(s)})}),n.sort((e,r)=>e.parsedTime-r.parsedTime);const m=((t=n[0])==null?void 0:t.parsedTime)??1/0,f=document.createDocumentFragment();n.forEach((e,r)=>{const s=e.parsedTime-m,a=document.createElement("div");a.classList.add("driver-row"),r===0&&a.classList.add("top-driver"),a.innerHTML=`
        <div class="position">
          #${r+1}
        </div>

        <div class="driver-info">
          <h3>
            ${e.nombreFinal}
          </h3>
        </div>

        <div class="lap-time">
          ${e.tiempo}
        </div>

        <div class="gap">
          ${I(s)}
        </div>
      `,f.appendChild(a)}),T.replaceChildren(...f.children)}catch(p){console.error(p)}}u();setInterval(u,36e5);
