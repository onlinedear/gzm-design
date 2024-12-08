import {App, createApp} from 'vue';
import { Icon } from '@arco-design/web-vue';

const IconFont = Icon.addFromIconFontCn({ src: '//at.alicdn.com/t/c/font_4462597_zbznbmcjcf.js'});

export default {
    install(app: App) {
        app.component('AliIcon', IconFont);
    }
}
