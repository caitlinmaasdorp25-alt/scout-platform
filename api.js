window.SCOUT_API = {
  token(){return localStorage.getItem('scoutToken')||''},
  async request(path, options={}){
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    const t=this.token(); if(t) headers.Authorization=`Bearer ${t}`;
    const res=await fetch(path,{...options,headers});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'SCOUT request failed');
    return data;
  },
  async register(data){const r=await this.request('/api/auth/register',{method:'POST',body:JSON.stringify(data)});if(r.token){localStorage.setItem('scoutToken',r.token);localStorage.setItem('scoutLoggedIn','true')}localStorage.setItem('scoutProfile',JSON.stringify(r.user));return r},
  async login(email,password){const r=await this.request('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});localStorage.setItem('scoutToken',r.token);localStorage.setItem('scoutLoggedIn','true');localStorage.setItem('scoutProfile',JSON.stringify(r.user));return r},
  async me(){return this.request('/api/me')},
  async verifyEmail(token){return this.request('/api/auth/verify-email',{method:'POST',body:JSON.stringify({token})})},
  async resendVerification(email){return this.request('/api/auth/resend-verification',{method:'POST',body:JSON.stringify({email})})},
  async forgotPassword(email){return this.request('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email})})},
  async resetPassword(token,password){return this.request('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token,password})})},
  async updateProfile(data){const r=await this.request('/api/me',{method:'PUT',body:JSON.stringify(data)});localStorage.setItem('scoutProfile',JSON.stringify(r.user));return r},
  async uploadAvatar(data){return this.request('/api/me/avatar',{method:'POST',body:JSON.stringify({data})})},
  async uploadPortfolioImage(index,data){return this.request('/api/me/portfolio-image',{method:'POST',body:JSON.stringify({index,data})})},
  async talentById(id){return this.request('/api/talent?id='+encodeURIComponent(id))},
  async talent(params=''){return this.request('/api/talent'+params)},
  async messages(){return this.request('/api/messages')},
  async sendMessage(toId,text){return this.request('/api/messages',{method:'POST',body:JSON.stringify({toId,text})})},
  async projects(){return this.request('/api/projects')},
  async postProject(data){return this.request('/api/projects',{method:'POST',body:JSON.stringify(data)})},
  async respond(projectId,data){return this.request(`/api/projects/${encodeURIComponent(projectId)}/responses`,{method:'POST',body:JSON.stringify(data)})},
  async mine(){return this.request('/api/projects/mine')},
  async logout(){try{await this.request('/api/auth/logout',{method:'POST'})}finally{localStorage.removeItem('scoutToken');localStorage.removeItem('scoutLoggedIn')}}
};
