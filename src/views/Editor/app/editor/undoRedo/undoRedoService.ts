import { MLeaferCanvas, IMLeaferCanvas } from '@/views/Editor/core/canvas/mLeaferCanvas'
import { UndoRedoBase } from '@/views/Editor/core/undoRedo/undoRedoBase'
import { KeybindingService, IKeybindingService } from '@/views/Editor/core/keybinding/keybindingService'
import { EventbusService, IEventbusService } from '@/views/Editor/core/eventbus/eventbusService'
import { IWorkspacesService, WorkspacesService } from '@/views/Editor/core/workspaces/workspacesService'
import { createDecorator } from '@/views/Editor/core/instantiation/instantiation'
import { Disposable } from '@/views/Editor/utils/lifecycle'
import { runWhenIdle, IDisposable } from '@/views/Editor/utils/async'
import { UndoRedoService, IUndoRedoService } from '@/views/Editor/core/undoRedo/undoRedoService'
import { CommandBase } from '@/views/Editor/core/undoRedo/commands'
import { debounce } from 'lodash'
import {PropertyEvent,DragEvent,ChildEvent} from "leafer-ui";
import {InnerEditorEvent} from "@leafer-in/editor";

export const IEditorUndoRedoService =
    createDecorator<EditorUndoRedoService>('editorUndoRedoService')

class SaveStateCommand extends CommandBase {
    constructor(
        private readonly workspacesService: WorkspacesService,
        private readonly editorUndoRedoService: EditorUndoRedoService,
        private pageId: string,
    ) {
        super()
    }

    public undo() {
        this.workspacesService.setCurrentId(this.pageId)
        this.editorUndoRedoService.undo()
    }

    public redo() {
        this.workspacesService.setCurrentId(this.pageId)
        this.editorUndoRedoService.redo()
    }
}

export class EditorUndoRedoService extends Disposable {
    declare readonly _serviceBrand: undefined

    private pageId: string
    private enablePropertyChange: boolean = true

    private undoRedos: Map<
        string,
        {
            instantiation: UndoRedoBase
            lastState: string | undefined
        }
    > = new Map()

    constructor(
        @IMLeaferCanvas private readonly canvas: MLeaferCanvas,
        @IKeybindingService readonly keybinding: KeybindingService,
        @IEventbusService private readonly eventbus: EventbusService,
        @IWorkspacesService private readonly workspacesService: WorkspacesService,
        @IUndoRedoService private readonly undoRedoService: UndoRedoService,
    ) {
        super()

        // 快捷键
        keybinding.bind('mod+z', () => {
            undoRedoService.undo()
        })
        keybinding.bind(['mod+y', 'mod+shift+z'], () => {
            undoRedoService.redo()
        })
        canvas.app.editor.on(DragEvent.END, (arg: PropertyEvent) => {
            if (this.enablePropertyChange) {
                this.saveState()
            }
        })
        canvas.contentLayer.on([ChildEvent.ADD, ChildEvent.REMOVE], (arg: PropertyEvent) => {
            if (this.enablePropertyChange) {
                this.saveState()
            }
        })


        let oldValue: null | string = null
        canvas.app.editor.on(InnerEditorEvent.BEFORE_OPEN, arg => {
            // 关闭文本默认全选
            arg.innerEditor.config.selectAll = false
            oldValue = arg.editTarget.text
        })
        canvas.app.editor.on(InnerEditorEvent.CLOSE, arg => {
            if (oldValue !== arg.editTarget.text) {
                oldValue = null
                this.saveState()
            }
        })

        this.pageId = this.workspacesService.getCurrentId()

        this.initWorkspace()
    }

    public canUndo() {
        return this.undoRedoService.canUndo.value
    }

    public canRedo() {
        return this.undoRedoService.canRedo.value
    }

    public disabledPropertyChangeWatch() {
        this.enablePropertyChange = false
    }

    public enablePropertyChangeWatch() {
        this.enablePropertyChange = true
    }

    private getUndoRedo() {
        return this.undoRedos.get(this.pageId)
    }

    public push(state: any) {
        const undoRedo = this.getUndoRedo()
        if (!undoRedo) return

        undoRedo.instantiation.push(state)
        this.eventbus.emit('undoRedoStackChange')
    }

    public redo() {
        const undoRedo = this.getUndoRedo()
        if (!undoRedo) return

        if (!undoRedo.instantiation.canRedo) return

        this.disabledPropertyChangeWatch()
        undoRedo.lastState = undoRedo.instantiation.redo(undoRedo.lastState)
        if (undoRedo.lastState) {
            this.loadJson(undoRedo.lastState)
            this.eventbus.emit('undoRedoStackChange')
        }

        this.enablePropertyChangeWatch()
        return undoRedo.lastState
    }

    public undo() {
        const undoRedo = this.getUndoRedo()
        if (!undoRedo) return

        if (!undoRedo.instantiation.canUndo) return
        undoRedo.lastState = undoRedo.instantiation.undo(undoRedo.lastState)
        if (undoRedo.lastState) {
            this.loadJson(undoRedo.lastState)
            this.eventbus.emit('undoRedoStackChange')
        }
        return undoRedo.lastState
    }

    public reset() {
        const undoRedo = this.getUndoRedo()
        if (!undoRedo) return

        undoRedo.instantiation.reset()
        this.eventbus.emit('undoRedoStackChange')
    }

    // private async loadJson(json: IUIInputData) {
    private async loadJson(json: string) {
        this.disabledPropertyChangeWatch()
        const undoRedo = this.getUndoRedo()
        if (!undoRedo) return
        const {instantiation} = undoRedo

        try {
            instantiation.pause()
            await this.canvas.importJsonToCurrentPage(JSON.parse(json))
        } finally {
            // this.canvas.contentLayer.updateLayout()
            this.enablePropertyChangeWatch()
            instantiation.resume()
        }
    }

    private getJson() {
        return JSON.stringify(this.canvas.contentFrame.toJSON())
    }

    private saveDispose: IDisposable | undefined

    // todo jsondiffpatch https://github.com/benjamine/jsondiffpatch
    public saveState = debounce(() => {
        console.log('saveState')
        const pageId = this.pageId
        this.saveDispose?.dispose()
        this.saveDispose = runWhenIdle(() => {
            if (pageId !== this.pageId) return
            const undoRedo = this.getUndoRedo()
            if (!undoRedo || !undoRedo.instantiation.isTracking) return
            this.push(undoRedo.lastState)
            undoRedo.lastState = this.getJson()
            // 添加命令
            this.undoRedoService.add(new SaveStateCommand(this.workspacesService, this, pageId))
        })
    }, 300)

    // 工作区 | 页面管理
    private initWorkspace() {
        const currentId = this.workspacesService.getCurrentId()
        this.workspacesService.all().forEach((workspace) => {
            this.undoRedos.set(workspace.id, {
                instantiation: new UndoRedoBase(),
                lastState: this.pageId === currentId ? this.getJson() : undefined,
            })
        })
        this.eventbus.on('workspaceAddAfter', ({newId}) => {
            this.undoRedos.set(newId, {
                instantiation: new UndoRedoBase(),
                lastState: this.pageId === newId ? this.getJson() : undefined,
            })
        })
        this.eventbus.on('workspaceRemoveAfter', (id) => {
            this.undoRedos.delete(id)
        })
        this.eventbus.on('workspaceChangeAfter', ({newId}) => {
            this.pageId = newId
        })
    }

    public dispose(): void {
        super.dispose()
        // 解绑事件绑定
        this.keybinding.unbind(['mod+z', 'mod+y', 'mod+shift+z'])
    }
}
