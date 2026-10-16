import { ViewPlugin, type EditorView } from '@codemirror/view';

/** Mirror the native openLink allowlist; final URL validation remains native-owned. */
export function openableLink(destination:string|null):destination is string {
  return destination!==null && /^(?:https?|mailto):/i.test(destination) && !/[\u0000-\u0020\u007f]/.test(destination);
}

/** Capture includes links rendered inside table widgets/nested mini-editors. */
export function linkOpening(open:(url:string)=>void,composing:()=>boolean) {
  return ViewPlugin.fromClass(class {
    constructor(readonly view:EditorView) {
      view.dom.addEventListener('mousedown',this.down,true);
      view.dom.addEventListener('click',this.click,true);
    }
    destination(event:MouseEvent):{element:Element;url:string|null}|null {
      const element=event.target instanceof Element ? event.target.closest('[data-live-link], a[href]') : null;
      return element && this.view.dom.contains(element) ? {element,url:element.getAttribute('data-live-link')??element.getAttribute('href')} : null;
    }
    down=(event:MouseEvent)=>{
      const link=this.destination(event);
      if(link && event.metaKey && event.button===0) {event.preventDefault();event.stopPropagation();}
    };
    click=(event:MouseEvent)=>{
      const link=this.destination(event);if(!link) return;
      // Anchors in rendered widgets never navigate WebContent, including inert URLs.
      if(link.element.matches('a')) event.preventDefault();
      if(!event.metaKey || event.button!==0) return;
      event.preventDefault();event.stopPropagation();
      if(!composing() && openableLink(link.url)) open(link.url);
    };
    destroy() {
      this.view.dom.removeEventListener('mousedown',this.down,true);
      this.view.dom.removeEventListener('click',this.click,true);
    }
  });
}
