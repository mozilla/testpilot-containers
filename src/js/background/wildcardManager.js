/**
  Manages mappings of Site Host <-> Wildcard Host.
  
  E.g. drive.google.com <-> google.com
  
  Wildcard subdomains: https://github.com/mozilla/multi-account-containers/issues/473
 */ 
const wildcardManager = { // eslint-disable-line no-unused-vars
  bySite:     new utils.NamedStore("siteToWildcardMap"),
  byWildcard: new utils.NamedStore("wildcardToSiteMap"),

  // Site -> Wildcard
  get(site) {
    return this.bySite.get(site);
  },
  
  async getAll(sites) {
    return this.bySite.getAll(sites);
  },
  
  async set(site, wildcard) {
    // Remove existing site -> wildcard
    const oldSite = await this.byWildcard.get(wildcard);
    if (oldSite === site) { return; } // Wildcard already set
    if (oldSite) { await this.bySite.remove(oldSite); }
    
    // Set new mappings site <-> wildcard
    await this.bySite.set(site, wildcard);
    await this.byWildcard.set(wildcard, site);
  },

  async remove(site) {
    const wildcard = await this.bySite.get(site);
    if (!wildcard) { return; }
    
    await this.bySite.remove(site);
    await this.byWildcard.remove(wildcard);
  },
  
  async removeAll(sites) {
    const data = await this.bySite.getAll(sites);
    const existingSites = Object.keys(data);
    const existingWildcards = Object.values(data);
    
    await this.bySite.removeAll(existingSites);
    await this.byWildcard.removeAll(existingWildcards);
  },
    
  // Site -> Site that owns Wildcard
  async match(site) {
    // Keep stripping subdomains off site domain until match a wildcard domain
    do {
      // Use the ever-shortening site hostname as if it is a wildcard
      const siteHavingWildcard = await this.byWildcard.get(site);
      if (siteHavingWildcard) { return siteHavingWildcard; }
    } while ((site = this._removeSubdomain(site)));
    return null;
  },
  
  _removeSubdomain(site) {
    const indexOfDot = site.indexOf(".");
    if (indexOfDot < 0) {
      return null;
    } else {
      return site.substring(indexOfDot + 1);
    }
  }    
};

