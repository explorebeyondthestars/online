const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
import { Writable, Readable } from "stream";
import { DataManagementSystem } from "../analytics/dataManagementSystem";
import crypto = require('crypto');

export interface AllocatableServer {
    getName(): string;

    start(): Promise<boolean>;

    getRoutesTable(): Object;
}

export class CollectorServer {
    public logStream: Writable;

    public async appendLog(logObject) {
        if (this.logStream === undefined) {
            let dms = new DataManagementSystem();
            this.logStream = await dms.getWritableStream(this.getName());
        }

        this.logStream.write(logObject);
    }

    public getName() {
        return "unnamedServer";
    }

    public getSocketName() {
        return __dirname + "/sockets/" + this.getName() + ".socket";
    }

    public onServerStarted(path: string): void {
        console.log(`Server ${this.getName()} started at ${path}`);
    }
}

export class HeartbeatsDataCollectorServer extends CollectorServer implements AllocatableServer {

    private resourcesDeclaration: any;

    public async start() {
        await this.listen();
        this.onServerStarted(this.getSocketName());
        return true;
    }

    public getName(): string {
        return "heartbeats";
    }

    public getSocketName(): string {
        return __dirname + "/sockets/" + this.getName() + ".socket";
    }

    private listen() {
        const app = express();
        this.registerRoutes(app);

        return new Promise((resolve, reject) => {

            let path = this.getSocketName();
            let server = app.listen(path, () => resolve(true));

            server.on('error', (e) => {
                console.log(e);
                process.exit(1);
            });

        });
    }

    public getRoutesTable(): Object {
        return {
            "from": this.resourcesDeclaration,
            "to": this.getSocketName()
        };
    }

    private registerRoutes(app: any) {
        app.use(
            bodyParser.json({
                type: "application/json"
            })
        );

        app.post('/heartbeats', (req, res) => this.postHeartbeatshandler(req, res));

        this.resourcesDeclaration = [
            '/heartbeats'
        ];
    }

    private postHeartbeatshandler(req, res) {
        this.handleNewHeartbeat(req, res)
    }

    private getOrigin(req) {
        let origin = req.headers['Origin'] || req.headers['origin'] || '';
        return origin;
    }

    private handleNewHeartbeat(req, res) {
        let justNow = Date.now();
        let origin = this.getOrigin(req);

        let newHeartbeat = {
            "receivedAt": justNow,
            "serialNumber": uuidv4(),
            "origin": origin
        };
        Object.assign(newHeartbeat, req.body);
    
        this.appendLog(newHeartbeat);
        res.json(newHeartbeat);
    }
}

export class IdentitiesLogsDataCollectorServer extends CollectorServer implements AllocatableServer {

    private resourceDeclaration: any;
    private keyStorage: Writable;
    private keyObject: any;

    public async start(): Promise<boolean> {
        await this.listen();
        this.onServerStarted(this.getSocketName());
        return true;
    }

    private listen() {
        const app = express();
        this.registerRoutes(app);

        return new Promise((resolve, reject) => {

            let path = this.getSocketName();
            let server = app.listen(path, () => resolve(true));

            server.on('error', (e) => {
                console.log(e);
                process.exit(1);
            });

        });
    }

    private async appendNewKey(keyObject) {
        let collectionName = "identityMasterKeys";

        if (this.keyStorage === undefined) {
            let dms = new DataManagementSystem();
            this.keyStorage = await dms.getWritableStream(collectionName);
        }

        this.keyStorage.write(keyObject);
    }

    private makeMasterKey() {
        return {
            "masterKey": uuidv4(),
            "datetime": Date.now()
        };
    }

    private getMasterSecret(): string {
        if (this.keyObject === undefined) {
            this.keyObject = this.makeMasterKey();
            this.appendNewKey(this.keyObject);
        }

        return this.keyObject.masterKey;
    }

    public getName() {
        return "identities";
    }

    public getRoutesTable() {
        return {
            "from": this.resourceDeclaration,
            "to": this.getSocketName()
        };
    }

    private registerRoutes(app) {
        app.use(
            bodyParser.json({
                type: "application/json"
            })
        );

        app.use(
            (err, req, res, next) => this.errorHandler(err, req, res, next)
        );

        this.resourceDeclaration = [
            '/identitiesLogs',
            '/identities'
        ];

        app.post('/identities', (req, res) => this.onIdentitiesRequest(req, res));
    }

    private errorHandler(err, req, res, next) {
        console.log(err.message);
        res.status(400);
        res.json({
            'message': err.message,
            'ok': false
        });
    }

    private onIdentitiesRequest(req, res) {
        let purpose = req.body.purpose;
        let result = true;
        let identity = {};

        if (purpose === 'issueNew') {
            identity = this.makeUUIDObject();
            res.json(identity);

            result = true;
        }

        let datetime = Date.now();
        let ipAddr = this.getIPAddress(req);
        let userAgent = this.getUserAgent(req);
        let origin = this.getOrigin(req);

        this.appendLog({
            "purpose": purpose,
            "datetime": datetime,
            "identity": identity,
            "ok": result,
            "serialNumber": uuidv4(),
            "ipAddr": ipAddr,
            "userAgent": userAgent,
            "origin": origin
        })
    }
    
    private makeUUIDObject() {
        const uuidString = uuidv4();
        const uuidHash = crypto.createHmac('sha512', this.getMasterSecret())
            .update(uuidString)
            .digest('hex');
        
        let uuidObject =  {
            uuid: uuidString,
            checkSum: uuidHash
        };
        
        return uuidObject;
    }
    
    public verifyUUIDObject(uuidObject) {
        const receivedUUIDHash = uuidObject.checkSum;
        const receivedUUIDString = uuidObject.uuid;
        const computedUUIDHash = crypto.createHmac('sha512', this.getMasterSecret())
            .update(receivedUUIDString)
            .digest('hex');
        
        let checkResult = computedUUIDHash === receivedUUIDHash;
    
        return checkResult;
    }
    
    private getUserAgent(req) {
        let ua = req.headers['User-Agent'] || 
            req.headers['user-agent'] ||
            '';
        return ua;
    }

    private getIPAddress(req) {
        let ip = req.headers['x-forwarded-for'] ||
            req.headers['X-Forwarded-For'] ||
            req.connection.remoteAddress;
    
        return ip;
    }

    private getOrigin(req) {
        let origin = req.headers['origin'] ||
            req.headers['Origin'] || '';
        
        return origin;
    }

}

let hbs = new HeartbeatsDataCollectorServer();
let ids = new IdentitiesLogsDataCollectorServer();
hbs.start();
ids.start();