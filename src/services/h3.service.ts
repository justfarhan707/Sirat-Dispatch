import * as h3 from "h3-js";

export class H3Service {

    static RESOLUTION = 9;

    static getIndex(lat: number, lng: number): string {
        return h3.latLngToCell(lat, lng, this.RESOLUTION);
    }

    static getNeighbours(h3index: string, ringsize = 1): string[] {
        return h3.gridDisk(h3index, ringsize);
    }

}