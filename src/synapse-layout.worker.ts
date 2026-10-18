import {layoutEvents, type SynapseEvent} from './synapse-layout';
self.onmessage=(message:MessageEvent<{generation:number;events:SynapseEvent[]}>)=>{self.postMessage({generation:message.data.generation,graph:layoutEvents(message.data.events)});};
