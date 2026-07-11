export namespace main {
	
	export class PageSpec {
	    path: string;
	    pageNumber: number;
	    rotation: number;
	    isBlank: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PageSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.pageNumber = source["pageNumber"];
	        this.rotation = source["rotation"];
	        this.isBlank = source["isBlank"];
	    }
	}

}

