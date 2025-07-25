import { Asset, assetManager, Canvas, EditBox, Game, game, gfx, Graphics, ImageAsset, isValid, Label, Sprite, SpriteFrame, Texture2D, UIRenderer, UITransform, Widget } from 'cc';
import { CCObject, Color, Component, Director, director, js, Node, Rect, Scene, Size, ValueType, Vec2, Vec3, Vec4 } from 'cc';
import { EDITOR, EDITOR_NOT_IN_PREVIEW } from 'cc/env';

let srclog = console.log;
let srcLogFunc = srclog;

export class Logger {
    static logEnable = false;
    static logSwitch() {
        this.logEnable = !this.logEnable;
        srcLogFunc = this.logEnable ? srclog : () => { };
    }

    static get log() {
        return srcLogFunc.bind(console);
    }
}

window['Logger'] = Logger;

function logPrefix() {
    const dateTime = new Date();
    return `${dateTime.getFullYear()}/${dateTime.getMonth() + 1}/${dateTime.getDate()} ${dateTime.getHours()}:${dateTime.getMinutes()}:${dateTime.getSeconds()} ${dateTime.getMilliseconds().toString().padStart(3, "0")}`;
}

/** 属性修改类型 */
enum PROP_EDIT_TYPE {
    /** 普通属性修改 */
    PROP,
    /** 结构监听 转为 Proxy */
    OBJECT,
    /** 重写func */
    FUNC_HOOK,
    /** 属性存在setter（比如  _prop 存在 名为 prop的setter） */
    SETTER,
    /** 资源、节点、或者组件类型 */
    CCOBJECT,
}

interface IPropEditRecordItem {
    type: PROP_EDIT_TYPE,
    original: TypedPropertyDescriptor<any> | Function;
    target?: any;
}

function getValueTypeName(value: ValueType): cvSupportType {
    if (value instanceof Vec3) {
        return 'Vec3';
    }
    else if (value instanceof Vec2) {
        return 'Vec2';
    }
    else if (value instanceof Vec4) {
        return 'Vec4';
    }
    else if (value instanceof Rect) {
        return 'Rect';
    }
    else if (value instanceof Size) {
        return 'Size';
    }


    return 'Object';
}

interface IPropCopy {
    value: any;
    type: cvSupportType;
    enumList?: { name: string, value: number }[];
    hasSetter: boolean;
}

export class ViewBridgeBase {

    protected _websocket: WebSocket;
    protected _connected: boolean = false;

    connect() {
        try {
            this._websocket = new WebSocket("ws://127.0.0.1:33000");
            this._websocket.onopen = this.onConnected.bind(this);
            this._websocket.onmessage = this.onReceiveMessage.bind(this);
            this._websocket.onclose = this.onSocketError.bind(this);
            this._websocket.onerror = this.onSocketError.bind(this);
        } catch (error) {
            console.log(error);
        }
    }

    close() {
        this._connected = false;
        if (this._websocket) {
            const websocket = this._websocket;
            
            this._websocket = undefined;
            websocket.close();
            websocket.onopen = undefined;
            websocket.onmessage = undefined;
            websocket.onclose = undefined;
            websocket.onerror = undefined;
        }
    }

    protected onSocketError() {
        console.log(`onSocketError  `);
        this.close();
        setTimeout(() => {
            this.connect();
        }, 500);
    }

    protected onConnected() {
        Logger.log(`on websocket connect 建立连接，发送节点树数据`);
        this._connected = true;
        this.syncScene();
    }

    protected sendData(viewerData: C2S_CreatorViewerMessage) {
        if (!this._connected) return;
        this._websocket?.send(JSON.stringify(viewerData));
    }

    protected onReceiveMessage(ev: MessageEvent) {
        try {
            const data = JSON.parse(ev.data) as S2C_CreatorViewerMessage;
            const type = data.type;
            Logger.log(`receive message `, data);
            switch (type) {
                case 'change_node_active': {
                    const node = globalInfo.allNodesMap.get(data.data.nodeUuid);
                    if (node) {
                        node.active = data.data.active;
                    }
                }
                    break;
                case 'node_parent_or_sibling_index_change': {
                    const node = globalInfo.allNodesMap.get(data.data.nodeUuid);
                    const newParentNode = globalInfo.allNodesMap.get(data.data.parentUuid);
                    if (node && newParentNode) {
                        newParentNode.insertChild(node, data.data.siblingIndex);
                    }
                }
                    break;
                case 'select_node': {
                    this.selectNodeByUUid(data.data);
                }
                    break;
                case 'on_tracker_prop_change': {
                    const tracker = globalInfo.trackers.get(data.data.targetUuid);
                    if (tracker) {
                        tracker.modifyTrackProp(data.data.propName, data.data.value);
                    }
                }
                    break;
            }
        } catch (error) {
            console.error(error);
        }
    }

    selectNodeByUUid(uuid: string) {
        const node = globalInfo.allNodeInfosMap.get(uuid);
        if (!node) {
            console.warn(`未找到 uuid 为 ${uuid} 的节点，选择失败`);
            return;
        }
        const trackers = node.selectNode();
        const serializeDatas: ICCObjectPropGroup[] = [];
        trackers.forEach(tracker => {
            serializeDatas.push(tracker.getSerializeData());
        })
        Logger.log(serializeDatas);
        this.sendData({ type: 'track_attrs', data: serializeDatas })
        // Logger.log(JSON.stringify(serializeDatas));
    }

    syncScene() {
        this.sendData({ type: "scene", data: [globalInfo.sceneTree] });
    }

    onNodeDestroyed(uuid: string) {
        this.sendData({ type: "node_destroyed", data: uuid });
    }

    onNodeActiveChanged(uuid: string, active: boolean) {
        this.sendData({ type: 'node_active_change', data: { nodeUuid: uuid, active: active } });
    }

    onChildRemove(uuid: string) {
        this.sendData({ type: 'child_removed', data: uuid });
    }

    onChildAdd(parentUuid: string, childNodeInfo: INodeInfo) {
        this.sendData({ type: 'child_added', data: { parentUuid: parentUuid, childInfo: childNodeInfo } });
    }

    onChildrenOrderChange(uuid: string, childrenOrder: Record<string, number>) {
        this.sendData({ type: 'children_order_change', data: { nodeUuid: uuid, childrenOrder: childrenOrder } });
    }

    onTrackedPropValueChanged(targetUuid: string, propName: string, newValue: any) {
        this.sendData({ type: 'on_tracked_prop_change', data: { targetUuid: targetUuid, propName: propName, newValue: newValue } });
    }
}

export class GlobalInfo {
    sceneTree: NodeInfo;
    trackers: Map<string, ViewElementTracker> = new Map();
    allNodesMap: Map<string, Node> = new Map();
    allNodeInfosMap: Map<string, NodeInfo> = new Map();

    selectedNode: NodeInfo;

    bridge: ViewBridgeBase = new ViewBridgeBase();

    getCCObjectClassEnum: Function = getCCObjectClassEnum;
}

const VIEWER_TRACKER = 'VIEWER_TRACKER';


const globalInfo = new GlobalInfo();
Reflect.defineProperty(window, "globalInfo", {
    value: globalInfo
})

type CCObjectConstructor = new (...args: any[]) => CCObject;

interface ITrackerPropConfig {
    key: string;
    alias?: string;
    setFuncs?: string[];
    setterKey?: string;
}

interface ITrackerPropEnumConfig {
    key: string;
    enumDefine: Object;
}

class ViewerColor {
    constructor(r: number, g: number, b: number, a: number) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }

    r: number;
    g: number;
    b: number;
    a: number;
}

interface IMultiSetterInfo {
    name: string;
    /** 是否是函数  true 为 function  false  为 setter */
    isFunc: boolean;
}

interface ITrackPropConfigGroup {
    customItems?: ITrackerPropConfig[];
    replaceMap?: Record<string, string>;
    multiSetters?: Record<string, IMultiSetterInfo[]>;
}

const ReflectForceSetterProps: Map<CCObjectConstructor, ITrackPropConfigGroup> = new Map();
globalInfo['ReflectForceSetterProps'] = ReflectForceSetterProps;

// CCObject 只处理ObjectFlag
ReflectForceSetterProps.set(CCObject,
    { customItems: [{ key: '_objFlags' }] }
);
// Node 特殊处理属性
ReflectForceSetterProps.set(Node, {
    customItems: [
        { key: "_lpos", alias: "position", setFuncs: ["setPosition", "setWorldPosition"] },
        { key: "_lscale", alias: "scale", setFuncs: ["setScale"] },
        { key: "_euler", alias: "eulerAngle", setterKey: 'eulerAngles' },
        { key: "_name" }
    ]
});

// Node 特殊处理属性
ReflectForceSetterProps.set(Sprite, {
    replaceMap: { '_useGrayscale': 'grayscale' }
});

// Node 特殊处理属性
ReflectForceSetterProps.set(UITransform, {
    multiSetters: { '_contentSize': [{ name: 'setContentSize', isFunc: true }], '_anchorPoint': [{ name: 'setAnchorPoint', isFunc: true }] },
});




const ClassEnumPropCustomDefine: Map<CCObjectConstructor, ITrackerPropEnumConfig[]> = new Map();
ClassEnumPropCustomDefine.set(UIRenderer, [{ key: '_srcBlendFactor', enumDefine: gfx.BlendFactor }, { key: '_dstBlendFactor', enumDefine: gfx.BlendFactor }]);

function NonEnumerable() {
    return function (target: any, key: string) {
        if (!target['hidden_props']) {
            target['hidden_props'] = [];
        }
        target['hidden_props'].push(key);
    };
}

function vclass() {
    return function <T extends new (...args: any[]) => any>(Ctor: T) {
        return class extends Ctor {
            constructor(...args: any[]) {
                super(...args);
                if (this['hidden_props']) {
                    this['hidden_props'].forEach(key => {
                        const descriptor = Reflect.getOwnPropertyDescriptor(this, key);
                        if (descriptor) {
                            descriptor.enumerable = false;
                            Reflect.defineProperty(this, key, descriptor);
                        }
                    })
                }
            }
        }
    }
}

/** 递归查找属性的描述器，自己找不到时，向prototype查找 */
function getPropertyDescriptor(obj: any, prop: PropertyKey): PropertyDescriptor | undefined {
    while (obj) {
        const descriptor = Reflect.getOwnPropertyDescriptor(obj, prop);
        if (descriptor) {
            return descriptor;
        }
        obj = Object.getPrototypeOf(obj);
    }
    return undefined;
}

function findCCObjectClassEnumConfig(ctor: CCObjectConstructor) {
    while (ctor) {
        if (ClassEnumPropCustomDefine.has(ctor)) {
            return ClassEnumPropCustomDefine.get(ctor);
        }

        //@ts-ignore
        ctor = Reflect.getPrototypeOf(ctor);
        if (!ctor) {
            return;
        }
    }
}

function getCCObjectClassEnum(target: CCObjectConstructor, propKey: string) {
    if (!target) return;

    const customDefine = findCCObjectClassEnumConfig(target);
    if (customDefine) {
        for (const cdefine of customDefine) {
            if (cdefine.key == propKey) {
                const enumList = [];
                let enumfilterCached = [];
                Object.keys(cdefine.enumDefine).forEach(key => {
                    if (enumfilterCached.includes(key)) return;
                    const reflectKey = cdefine.enumDefine[key];
                    enumfilterCached.push(reflectKey);
                    enumList.push({
                        name: reflectKey,
                        value: parseInt(key)
                    })
                })
                return enumList;
            }
        }
    }
    if (target['__attrs__']) {
        const enumKey = `${propKey}$_$enumList`;
        if (target['__attrs__'][enumKey]) {
            return target['__attrs__'][enumKey];
        }

        if (propKey.startsWith('_')) {
            const setterKey = propKey.substring(1);

            const setterEnumKey = `${setterKey}$_$enumList`;
            if (target['__attrs__'][setterEnumKey]) {
                return target['__attrs__'][setterEnumKey];
            }
        }

        const prototype = Object.getPrototypeOf(target['__attrs__']);
        if (prototype) {
            return getCCObjectClassEnum(prototype, propKey);
        }
    }
}

function getCCObjectClassPropTypeMatch<T extends CCObjectConstructor>(target: CCObjectConstructor, setterKey: string, propName: string, parentClass: T): CCObjectConstructor {
    if (!target) return;

    if (target['__attrs__']) {
        const setterClass = target['__attrs__'][`${setterKey}$_$ctor`];
        if (setterClass) {
            return js.isChildClassOf(setterClass, parentClass) ? setterClass : undefined;
        }

        const srcClass = target['__attrs__'][`${propName}$_$ctor`];
        if (srcClass) {
            return js.isChildClassOf(srcClass, parentClass) ? srcClass : undefined;
        }

        const prototype = Object.getPrototypeOf(target['__attrs__']);
        if (prototype) {
            return getCCObjectClassPropTypeMatch(prototype, setterKey, propName, parentClass);
        }
    }
}

/** ElementTracker */
class ViewElementTracker {
    static trackTarget(target: Node | Component) {
        if (!isValid(target)) return;

        const tracker = new ViewElementTracker(target);
        Reflect.defineProperty(target, VIEWER_TRACKER, {
            value: tracker,
            enumerable: false,
            writable: false,
            configurable: true
        });

        return tracker;
    }

    static unTrackTarget(target: Node | Component) {
        const tracker: ViewElementTracker = Reflect.get(target, VIEWER_TRACKER);
        if (!tracker) return;
        tracker.unTrack();
    }

    protected _target: Node | Component;

    /** 被追踪的属性记录 */
    protected _trackedPropsMap: Map<string, IPropEditRecordItem> = new Map();

    /** 被追踪对象修改的属性对应的缓存替换变量 */
    protected _targetPropsReplacer: Record<string, any> = {};
    protected _propName2KeyMap: Map<string, string> = new Map();

    protected _trackPropCopys: Map<string, IPropCopy> = new Map();

    protected _uuid: string = '';

    protected _type: 'node' | 'component' = 'node';

    protected _name: string = "";

    constructor(elementTarget: Node | Component) {
        this._target = elementTarget;
        this._uuid = elementTarget.uuid;
        this._type = elementTarget instanceof Node ? "node" : "component";
        if (elementTarget instanceof Node) {
            this._name = elementTarget.name;
        }
        else if (elementTarget instanceof Component) {
            this._name = js.getClassName(elementTarget);
        }

        globalInfo.trackers.set(this._uuid, this);
        const preloadFunc = this._target['_onPreDestroy'];
        const self = this;
        if (preloadFunc) {
            this.recordCCObjectEdit('_onPreDestroy', PROP_EDIT_TYPE.FUNC_HOOK, preloadFunc);
            this._target['_onPreDestroy'] = function (...args) {
                self.unTrack();
                return preloadFunc.apply(self._target, args);
            }
        }

        this.analyzeTargetTrack();
    }

    /** 记录被修改的属性，用于节点反选时恢复属性被修改了监听方法之前的原始值 */
    protected recordCCObjectEdit(key: string, type: PROP_EDIT_TYPE, original: TypedPropertyDescriptor<any> | Function, target?: any) {
        this._trackedPropsMap.set(key, {
            type: type,
            original: original,
            target: target
        });
    }

    /** 记录哪些属性被追踪，用于传递给节点树端 */
    protected recordPropTrack(propKey: string, alias: string, trackKey: string, originalValue: any, hasSetter: boolean, engineClass?: CCObjectConstructor) {
        const aliasOrPropKey = alias || propKey;

        if (engineClass) {
            if (js.isChildClassOf(engineClass, Node)) {
                this._trackPropCopys.set(aliasOrPropKey, {
                    type: 'Node',
                    value : {
                        isValid : isValid(originalValue),
                        nodeName : (originalValue as Node)?.name || "None",
                        nodeUuid : (originalValue as Node)?.uuid || ""
                    } as INodeTypeData,
                    hasSetter: hasSetter
                })
            }
            else if (js.isChildClassOf(engineClass, Component)) {
                this._trackPropCopys.set(aliasOrPropKey, {
                    type: 'Component',
                    value: {
                        isValid : isValid(originalValue),
                        nodeUuid : (originalValue as Component)?.node?.uuid || "",
                        componentName : js.getClassName(engineClass),
                        nodeName : (originalValue as Component)?.node?.name || "",
                    } as IComponentTypeData,
                    hasSetter: false
                })
            }
            else if (js.isChildClassOf(engineClass, Asset)) {
                const assetValue = originalValue as Asset;
                
                this._trackPropCopys.set(aliasOrPropKey, {
                    type: 'Asset',
                    value: {
                        className : js.getClassName(engineClass),
                        assetName : assetValue?.name || ""
                    } as IAssetTypeData,
                    hasSetter: false
                })
            }
        }
        else if (typeof (originalValue) == "object") {
            // Logger.log(`record prop track value Type ${aliasOrPropKey} `, originalValue);
            if (originalValue instanceof ValueType) {
                if (originalValue instanceof Color) {
                    const copyObject = new ViewerColor(originalValue.r, originalValue.g, originalValue.b, originalValue.a);
                    this._trackPropCopys.set(aliasOrPropKey, {
                        type: 'Color',
                        value: copyObject,
                        hasSetter: hasSetter
                    })
                    Logger.log(JSON.stringify(copyObject));
                }
                else {
                    const copyObject = originalValue.clone();
                    this._trackPropCopys.set(aliasOrPropKey, {
                        type: getValueTypeName(originalValue),
                        value: copyObject,
                        hasSetter: hasSetter
                    })
                    Logger.log(JSON.stringify(copyObject));
                }
            }
        }
        else {
            // @ts-ignore 获取属性枚举列表如果不是枚举则为空
            const enumList = getCCObjectClassEnum(this._target.constructor, propKey);
            if (enumList) {
                this._trackPropCopys.set(aliasOrPropKey, {
                    type: 'Enum',
                    value: {
                        enumItems: enumList,
                        enumValue: originalValue
                    },
                    enumList: enumList,
                    hasSetter: hasSetter
                });
            }
            else {
                this._trackPropCopys.set(aliasOrPropKey, {
                    //@ts-ignore
                    type: typeof (originalValue),
                    value: originalValue,
                    // enumList : enumList,
                    hasSetter: hasSetter
                });
            }
        }

        this._propName2KeyMap.set(aliasOrPropKey, trackKey);
    }

    protected restoreTracker() {
        this._trackedPropsMap.forEach((prop, key) => {
            if (prop.type == PROP_EDIT_TYPE.PROP) {
                const curValue = this._target[key];
                Reflect.defineProperty(this._target, key, prop.original);
                if (typeof (curValue) == 'object') {
                    Object.keys(curValue).forEach(subKey => {
                        this._target[subKey] = curValue[subKey];
                    })
                }
                else {
                    this._target[key] = curValue;
                }
            }
            else if(prop.type == PROP_EDIT_TYPE.CCOBJECT) {
                const curValue = this._target[key];
                Reflect.defineProperty(this._target, key, prop.original);
                this._target[key] = curValue;
            }
            else if (prop.type == PROP_EDIT_TYPE.OBJECT) {
                Reflect.defineProperty(this._target, key, prop.original);
            }
            else if (prop.type == PROP_EDIT_TYPE.FUNC_HOOK) {
                if (prop.target) {
                    prop.target = prop.original;
                }
                else {
                    this._target[key] = prop.original;
                }
            }
            else if (prop.type == PROP_EDIT_TYPE.SETTER) {
                const setterDescriptor = Reflect.getOwnPropertyDescriptor(this._target, key);
                //@ts-ignore
                setterDescriptor.set = prop.original;
                Reflect.defineProperty(this._target, key, setterDescriptor);
            }
        });
        this._trackedPropsMap.clear();

        Reflect.deleteProperty(this._target, VIEWER_TRACKER);
    }

    protected onPropValueChange(aliasOrKey: string, newValue: any, engineClassType ?: cvSupportType) {
        Logger.log(`on prop value change ${aliasOrKey} `, newValue);
        const trackedProp = this._trackPropCopys.get(aliasOrKey);
        if (!trackedProp) {
            console.warn(`prop  ${aliasOrKey} is not tracked`);
            return;
        }

        if (newValue instanceof ValueType) {
            if (newValue instanceof Color) {
                const color = (trackedProp.value as ViewerColor);
                color.r = newValue.r;
                color.g = newValue.g;
                color.b = newValue.b;
                color.a = newValue.a;
            }
            else {
                const value = (trackedProp.value as ValueType);
                value.set(newValue);
            }
        }
        else {
            if(engineClassType == 'Asset') {
                const value = (trackedProp.value as IAssetTypeData);
                value.assetName = newValue?.name || "";
                newValue = value;
            }
            else if(engineClassType == 'Component') {
                const value = (trackedProp.value as IComponentTypeData);
                value.isValid = isValid(newValue);
                value.nodeUuid = (newValue as Component)?.node?.uuid || "";
                value.nodeName = (newValue as Component)?.node?.name || "";
                newValue = value;
            }
            else if(engineClassType == 'Node') {
                const value = (trackedProp.value as INodeTypeData);
                value.isValid = isValid(newValue);
                value.nodeUuid = (newValue as Component)?.node?.uuid || "";
                value.nodeName = (newValue as Component)?.node?.name || "";
                newValue = value;
            }
            else {
                trackedProp.value = newValue;
            }
        }

        globalInfo.bridge.onTrackedPropValueChanged(this._uuid, aliasOrKey, newValue);
    }

    modifyTrackProp(propName: string, value: any) {
        const trackKey = this._propName2KeyMap.get(propName);
        if (!trackKey) {
            console.warn(`modifyTrackProp error -> prop ${propName} is not in tracking`);
            return;
        }

        const tracker = this._trackedPropsMap.get(trackKey);
        if (!tracker) {
            console.warn(`modifyTrackProp error -> tracker ${trackKey} is not exist`);
            return;
        }

        if (typeof tracker.original == "function") {
            tracker.original.call(tracker.target || this._target, value);
        }
        else {
            if (Reflect.has(this._targetPropsReplacer, propName)) {
                if (typeof (this._targetPropsReplacer[propName]) == "object" && typeof (value) == 'object') {
                    Object.keys(value).forEach(key => {
                        this._targetPropsReplacer[propName][key] = value[key];
                    })
                }
                else if (typeof (this._targetPropsReplacer[propName]) == typeof (value)) {
                    this._targetPropsReplacer[propName] = value;
                }
            }
            //
            Logger.log(`value tracker change`, tracker);
        }
    }

    getSerializeData(): ICCObjectPropGroup {
        const propsArray = [];
        this._trackPropCopys.forEach((valueCopy, key) => {
            propsArray.push({
                value: valueCopy.value,
                type: valueCopy.type,
                key: key
            })
        })

        return {
            type: this._type,
            name: this._name,
            uuid: this._uuid,
            props: propsArray,
        };
    }

    getType() {
        return this._type;;
    }

    protected processPropTrack(key: string, alias?: string, setFuncs?: string[], customSetterKey?: string, multiSetters?: Record<string, IMultiSetterInfo[]>) {
        if (this._trackedPropsMap.has(key)) return;
        const srcValue = this._target[key];
        const self = this;


        let setterKeyAsset = customSetterKey;
        if (!setterKeyAsset && key.startsWith("_")) {
            setterKeyAsset = key.substring(1);
        }

        const engineClass = getCCObjectClassPropTypeMatch(this._target.constructor as CCObjectConstructor, setterKeyAsset, key, Asset) ||
            getCCObjectClassPropTypeMatch(this._target.constructor as CCObjectConstructor, setterKeyAsset, key, Node) || 
        getCCObjectClassPropTypeMatch(this._target.constructor as CCObjectConstructor, setterKeyAsset, key, Component);

        if(engineClass) {
            const propDescriptor = getPropertyDescriptor(this._target, key);
            this.recordCCObjectEdit(key, PROP_EDIT_TYPE.CCOBJECT, propDescriptor);
            this.recordPropTrack(key, alias, key, this._target[key], false, engineClass);
            this._targetPropsReplacer[key] = this._target[key];
            const self = this;
            let engineClassName : cvSupportType;
            if(js.isChildClassOf(engineClass, Asset)) {
                engineClassName = 'Asset';
            }
            else if(js.isChildClassOf(engineClass, Node)) {
                engineClassName = 'Node';
            }
            else if(js.isChildClassOf(engineClass, Component)) {
                engineClassName = 'Component';

                console.log(`Prop Track Component`);
            }

            Reflect.defineProperty(this._target, key, {
                set(value) {
                    self.onPropValueChange(alias || key, value, engineClassName);
                    // 用 Reflect.apply 来调用原始 setter
                    self._targetPropsReplacer[key] = value;
                },
                get() {
                    return self._targetPropsReplacer[key];
                }, // 保持 getter 不变
                configurable: propDescriptor.configurable,
                enumerable: propDescriptor.enumerable
            });
            return;
        }

        if (setFuncs && setFuncs.length > 0) {
            let hasSetTrackProp = false;
            for (const setFunc of setFuncs) {
                const srcFunc = this._target[setFunc];
                this._target[setFunc] = function (...args) {
                    const result = srcFunc.apply(self._target, args);
                    self.onPropValueChange(alias || key, self._target[key]);
                    return result;
                }

                this.recordCCObjectEdit(setFunc, PROP_EDIT_TYPE.FUNC_HOOK, srcFunc);
                if (!hasSetTrackProp) {
                    this.recordPropTrack(key, alias, setFunc, this._target[key], true);
                    hasSetTrackProp = true;
                }
            }

            return;
        }

        // 处理存在 _prop的变量 并且有 prop的 setter 方法，认定为同一个属性
        if (key.startsWith("_")) {
            const setterKey = customSetterKey || key.substring(1);
            const setterDescriptor = getPropertyDescriptor(this._target, setterKey);

            let hasRecordProp = false;
            if (typeof (setterDescriptor?.set) == "function") {
                const originalSetter = setterDescriptor.set;
                this.recordCCObjectEdit(setterKey, PROP_EDIT_TYPE.SETTER, originalSetter);
                this.recordPropTrack(key, alias, setterKey, this._target[key], true);
                setterDescriptor.set = function (...args) {
                    self.onPropValueChange(alias || key, args[0]);
                    originalSetter.apply(self._target, args);
                }

                Reflect.defineProperty(this._target, setterKey, setterDescriptor);
                hasRecordProp = true;
            }

            if (multiSetters && multiSetters[key]) {
                multiSetters[key].forEach(info => {
                    if (info.isFunc) {
                        const srcFunc = this._target[info.name];
                        this._target[info.name] = function (...args) {
                            const result = srcFunc.apply(self._target, args);
                            self.onPropValueChange(alias || key, self._target[key]);
                            return result;
                        }
                        this.recordCCObjectEdit(info.name, PROP_EDIT_TYPE.FUNC_HOOK, srcFunc);
                        if (!hasRecordProp) {
                            this.recordPropTrack(key, alias, setterKey, this._target[key], true);
                            hasRecordProp = true;
                        }
                    }
                    else {
                        // const multiSetterDescriptor = getPropertyDescriptor(this._target, info.name);

                        // if (typeof (multiSetterDescriptor?.set) == "function") {
                        //     const originalSetter = multiSetterDescriptor.set;
                        //     this.recordCCObjectEdit(info.name, PROP_EDIT_TYPE.SETTER, originalSetter);
                        //     if(!hasRecordProp) {
                        //         this.recordPropTrack(key, alias, info.name, this._target[key], true);
                        //         hasRecordProp = true;
                        //     }

                        //     multiSetterDescriptor.set = function (...args) {
                        //         self.onPropValueChange(alias || key, args[0]);
                        //         originalSetter.apply(self._target, args);
                        //     }

                        //     Reflect.defineProperty(this._target, setterKey, multiSetterDescriptor);
                        //     hasRecordProp = true;
                        // }
                    }
                })
            }
            if (hasRecordProp) return;
            // Logger.log(`set key ${setterKey}   `, setterDescriptor);

        }

        // Node Component Asset 当做普通变量处理
        if (typeof (srcValue) == "object") {
            if (srcValue instanceof Color) {
                const originalSet = srcValue['set'];
                this.recordCCObjectEdit(key, PROP_EDIT_TYPE.FUNC_HOOK, originalSet, srcValue);
                this.recordPropTrack(key, alias, key, this._target[key], false);
                srcValue['set'] = function (...args) {
                    self.onPropValueChange(alias || key, args[0]);
                    return originalSet.apply(srcValue, args);
                }
            }
            else if (srcValue instanceof Vec3 || srcValue instanceof Vec2 || srcValue instanceof Vec4 || srcValue instanceof Size || srcValue instanceof Rect) {
                const setterDescriptor = Reflect.getOwnPropertyDescriptor(this._target, key);
                this.recordCCObjectEdit(key, PROP_EDIT_TYPE.OBJECT, setterDescriptor);
                this.recordPropTrack(key, alias, key, this._target[key], false);
                const proxy = new Proxy(this._target[key], {
                    set(target, p, newValue, receiver) {
                        const result = Reflect.set(target, p, newValue);
                        self.onPropValueChange(alias || key, self._target[key]);
                        return result;
                    },
                });

                Reflect.defineProperty(this._target, key, {
                    value: proxy, // 保持 getter 不变
                    configurable: setterDescriptor.configurable,
                    enumerable: setterDescriptor.enumerable
                });
            }
            else {
                Logger.log(`normal object will not track key ${key}`, this._target[key]);
            }
        }
        else {
            const propDescriptor = getPropertyDescriptor(this._target, key);
            this.recordCCObjectEdit(key, PROP_EDIT_TYPE.PROP, propDescriptor);
            this.recordPropTrack(key, alias, key, this._target[key], false);
            this._targetPropsReplacer[key] = this._target[key];
            const self = this;
            Reflect.defineProperty(this._target, key, {
                set(value) {
                    self.onPropValueChange(alias || key, value);
                    // 用 Reflect.apply 来调用原始 setter
                    self._targetPropsReplacer[key] = value;
                },
                get() {
                    return self._targetPropsReplacer[key];
                }, // 保持 getter 不变
                configurable: propDescriptor.configurable,
                enumerable: propDescriptor.enumerable
            });
        }
    }

    protected analyzeTargetTrack() {
        // 强制将属性改为setter，变量的setter方法和protected属性的名称不匹配或者setter未被正确使用时，手动添加属性至此，会强制将属性添加到setter中监听
        //  需要手动修改配置 比如 node的 siblingIndex 即使有setter 但是 刷新的时候是直接赋值的 _siblingIndex，未调用 set siblingIndex
        for (const ctor of ReflectForceSetterProps.keys()) {
            if (this._target instanceof ctor) {
                const fprops = ReflectForceSetterProps.get(ctor);
                fprops.customItems?.forEach(fprop => {
                    this.processPropTrack(fprop.key, fprop.alias, fprop.setFuncs, fprop.setterKey);
                })
            }
        }

        const reflectSetter = ReflectForceSetterProps.get(this._target.constructor as CCObjectConstructor);
        let hasCustomSetterConfig = false;
        let hasReplaceSetter = false;
        let multiSetters: Record<string, IMultiSetterInfo[]>;
        Logger.log('analyzeTargetTrack', this._target);

        if (reflectSetter) {
            hasCustomSetterConfig = Reflect.has(reflectSetter, 'customItems');
            hasReplaceSetter = Reflect.has(reflectSetter, 'replaceMap');
            multiSetters = reflectSetter.multiSetters;
            Logger.log(reflectSetter, this._target);
        }

        // 如果没有特殊处理，默认全部属性都监听
        if (!hasCustomSetterConfig) {
            const valueKeys = this._target.constructor?.['__values__'] || [];
            Reflect.ownKeys(this._target).forEach(key => {
                if (!valueKeys.includes(key) || key == "node") return;
                if (hasReplaceSetter) {
                    //@ts-ignore
                    this.processPropTrack(key.toString(), reflectSetter['replaceMap'][key], undefined, reflectSetter['replaceMap'][key], multiSetters);
                }
                else {
                    this.processPropTrack(key.toString(), undefined, undefined, undefined, multiSetters);
                }
            })
        }
    }

    unTrack() {
        globalInfo.trackers.delete(this._uuid);
        this.restoreTracker();
    }
}

@vclass()
class NodeInfo {
    static index: number = 0;
    name: string = "";
    uuid: string = "";
    children: NodeInfo[] = [];
    // activeInHierarchy : boolean = false;
    active: boolean = false;

    @NonEnumerable()
    childrenUUidMap: Map<string, NodeInfo> = new Map();

    @NonEnumerable()
    childrenNameMap: Map<string, NodeInfo> = new Map();

    @NonEnumerable()
    parent: NodeInfo;

    @NonEnumerable()
    protected _index: number = NodeInfo.index++;

    @NonEnumerable()
    siblingIndex: number = 0;

    constructor(node: Node) {
        this.siblingIndex = node.getSiblingIndex();
        node.on(Node.EventType.CHILD_REMOVED, this.onChildRemove, this);
        node.on(Node.EventType.CHILD_ADDED, this.onChildAdd, this);
        node.on(Node.EventType.CHILDREN_ORDER_CHANGED, this.onChildrenOrderChange, this);
        node.on(Node.EventType.COMPONENT_ADDED, this.onComponentAdd, this);
        node.on(Node.EventType.NODE_DESTROYED, this.onNodeDestroyed, this);
        node.on(Node.EventType.ACTIVE_CHANGED, this.onActiveChanged, this);
        globalInfo.allNodeInfosMap.set(node.uuid, this);
        globalInfo.allNodesMap.set(node.uuid, node);
    }

    clearListeners() {
        const node = globalInfo.allNodesMap.get(this.uuid);
        if (!isValid(node)) return;
        node.targetOff(this);
    }

    protected onComponentAdd(component: Component) {

    }

    protected onActiveChanged(node: Node) {
        if (node.active == this.active) return;
        this.active = node.active;
        globalInfo.bridge.onNodeActiveChanged(this.uuid, node.active);
    }

    protected onNodeDestroyed() {
        Logger.log(`on node ${this.name} destroyed`);
        if (globalInfo.selectedNode === this) {
            this.unSelectNode();
            globalInfo.selectedNode = undefined;
        }

        globalInfo.bridge.onNodeDestroyed(this.uuid);
        globalInfo.allNodeInfosMap.delete(this.uuid);
        globalInfo.allNodesMap.delete(this.uuid);
    }

    addChildNodeInfo(nodeInfo: NodeInfo) {
        this.children.push(nodeInfo);
        this.childrenUUidMap.set(nodeInfo.uuid, nodeInfo);
        this.childrenNameMap.set(nodeInfo.name, nodeInfo);
    }

    protected onChildRemove(child: Node) {
        Logger.log(`on child removed ${child.uuid}`, this);
        const index = this.children.findIndex(nodeInfo => nodeInfo.uuid == child.uuid);
        this.childrenUUidMap.delete(child.uuid);
        this.childrenNameMap.delete(child.name);

        if (index != -1) {
            this.children.splice(index, 1);
        }
        globalInfo.bridge.onChildRemove(child.uuid);
    }

    protected onChildAdd(child: Node) {
        // Logger.log(new Error().stack);
        Logger.log(`on child add ${child.uuid}    index : ${this._index}`, this);
        const childInfo = globalInfo.allNodeInfosMap.get(child.uuid) || walkNode(child, this);
        this.addChildNodeInfo(childInfo);

        // setTimeout(()=>{
        //     globalInfo.bridge.onChildAdd(this.uuid, childInfo);
        // },10);
        globalInfo.bridge.onChildAdd(this.uuid, childInfo);
    }

    onChildrenOrderChange() {
        Logger.log(`on children order change`);
        const selfNode = globalInfo.allNodesMap.get(this.uuid);

        const childrenOrder: Record<string, number> = {};
        selfNode?.children.forEach(node => {
            if (this.childrenUUidMap.has(node.uuid)) {
                this.childrenUUidMap.get(node.uuid).siblingIndex = node.getSiblingIndex();
            }
            childrenOrder[node.uuid] = node.getSiblingIndex();
        })

        this.children.sort((a, b) => a.siblingIndex - b.siblingIndex);

        globalInfo.bridge.onChildrenOrderChange(this.uuid, childrenOrder);
        // globalInfo.bridge.onChildrenOrderChange(this.uuid, childrenOrder);
    }

    onNodeNameChange(newName: string) {
        const oldName = this.name;
        this.name = newName;
    }

    setNodePosition(x: number, y: number, z?: number) {
        const node = globalInfo.allNodesMap.get(this.uuid);
        if (!node) return;
        node.setPosition(x, y, z);
    }

    get path() {
        return (this.parent ? this.parent.path + "/" : "") + this.name;
    }

    get components() {
        return globalInfo.allNodesMap.get(this.uuid)?.components || [];
    }

    selectNode() {
        globalInfo.selectedNode?.unSelectNode();
        globalInfo.selectedNode = this;
        const trackers: ViewElementTracker[] = [];
        trackers.push(ViewElementTracker.trackTarget(globalInfo.allNodesMap.get(this.uuid)));
        this.components.forEach(comp => {
            trackers.push(ViewElementTracker.trackTarget(comp));
        })
        return trackers;
    }

    unSelectNode() {
        this.components.forEach(comp => {
            ViewElementTracker.unTrackTarget(comp);
        });
        ViewElementTracker.unTrackTarget(globalInfo.allNodesMap.get(this.uuid));
    }

    getChildByPath(path: string) {
        const pathSplit = path.split('/');
        let parentNode: NodeInfo = this;
        for (const split of pathSplit) {
            if (!split) continue;

            parentNode = parentNode.childrenNameMap.get(split);
            if (!parentNode) {
                return;
            }
        }

        return parentNode;
    }
}

function walkNode(node: Node, parent?: NodeInfo) {
    if (globalInfo.allNodeInfosMap.has(node.uuid)) {
        Logger.log(`walk same node`);
        return globalInfo.allNodeInfosMap.get(node.uuid);
    }
    const nodeInfo = new NodeInfo(node);
    nodeInfo.name = node.name;
    nodeInfo.uuid = node.uuid;
    nodeInfo.parent = parent;
    nodeInfo.active = node.active;
    node.children.forEach(child => nodeInfo.addChildNodeInfo(walkNode(child, nodeInfo)));
    return nodeInfo;
}

if (!EDITOR) {
    function patchNode() {
        // 获取原始属性描述符
        const descriptor = Reflect.getOwnPropertyDescriptor(Node.prototype, 'name');
        if (descriptor && typeof descriptor.set === 'function') {
            const originalSetter = descriptor.set;

            Reflect.defineProperty(Node.prototype, 'name', {
                set(value: string) {
                    const uuid = this.uuid;
                    if (globalInfo.allNodeInfosMap.has(uuid)) {
                        const nodeInfo = globalInfo.allNodeInfosMap.get(uuid);
                        nodeInfo.onNodeNameChange(value);
                    }
                    // 用 Reflect.apply 来调用原始 setter
                    Reflect.apply(originalSetter, this, [value]);
                },
                get: descriptor.get, // 保持 getter 不变
                configurable: true,
                enumerable: true,
            });
        }
    }

    patchNode();

    director.on(Director.EVENT_BEFORE_SCENE_LOADING, (scene: Scene) => {
        globalInfo.allNodeInfosMap.forEach(nodeInfo => nodeInfo.clearListeners());
        globalInfo.allNodesMap.clear();
        globalInfo.allNodeInfosMap.clear();
        globalInfo.trackers.forEach(tracker => tracker.unTrack());
        globalInfo.selectedNode = undefined;
    })

    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, (scene: Scene) => {
        globalInfo.allNodeInfosMap.forEach(nodeInfo => nodeInfo.clearListeners());
        globalInfo.allNodesMap.clear();
        globalInfo.allNodeInfosMap.clear();
        globalInfo.sceneTree = walkNode(scene);
        globalInfo.bridge.syncScene();
    })

    game.on(Game.EVENT_GAME_INITED, () => { globalInfo.bridge.connect() });

    function drawRoundedRect(g: Graphics, x: number, y: number, w: number, h: number, r: number) {
        g.moveTo(x + r, y);
        g.roundRect(x, y, w, h,r);
    }

    function createCreatorViewDebugLayer() {

        const width = 8;
        const height = 8;

        // 创建纯白像素数据
        const whitePixel = new Uint8Array(width * height * 4);
        for (let i = 0; i < whitePixel.length; i += 4) {
            whitePixel[i] = 255;     // R
            whitePixel[i + 1] = 255; // G
            whitePixel[i + 2] = 255; // B
            whitePixel[i + 3] = 255; // A
        }

        // 创建 Texture2D
        const texture = new Texture2D();
        texture.reset({
            width,
            height,
            format: Texture2D.PixelFormat.RGBA8888,
        });
        texture.uploadData(whitePixel); 

        // 创建 SpriteFrame
        const spriteFrame = new SpriteFrame();
        spriteFrame.texture = texture;

        // 创建节点并添加组件
        const node = new Node('WhiteSprite');
        const sprite = node.addComponent(Sprite);
        sprite.spriteFrame = spriteFrame;

        // 设置尺寸
        const uiTransform = node.getComponent(UITransform);
        uiTransform.setContentSize(100, 100); // 你想要的宽高


        // setTimeout(()=>{
        //     director.getScene().getChildByName("Canvas").addChild(node);
        // }, 3000);
        // 添加到场景中
        const canvasNode = new Node();
        const widget = canvasNode.addComponent(Widget);
        canvasNode.addComponent(Canvas);
        widget.isAlignBottom = widget.isAlignTop = widget.isAlignLeft = widget.isAlignRight = true;
        widget.bottom = widget.top = widget.left = widget.right = 0;
        director.addPersistRootNode(canvasNode);

        const graphicsNode = new Node();
        const graphicsComp = graphicsNode.addComponent(Graphics);
        drawRoundedRect(graphicsComp, 0, 0, 200, 60, 10);
        graphicsComp.fillColor = Color.YELLOW;
        graphicsComp.fill();
        canvasNode.addChild(graphicsNode);
        const edit = graphicsNode.addComponent(EditBox);
        edit.inputMode = EditBox.InputMode.SINGLE_LINE;
        const inputLabel = graphicsNode.getChildByName('TEXT_LABEL').getComponent(Label);
        inputLabel.fontSize = 26;
        inputLabel.color = Color.BLACK;
    }
    createCreatorViewDebugLayer();
}