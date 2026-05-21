import { app, Menu, MenuItemConstructorOptions, shell } from 'electron'

/**
 * Standard macOS application menu. Without this we miss Cmd+Q/W/H,
 * Edit (cut/copy/paste in inputs), and the dev shortcuts. The Window
 * menu also lets the user re-show the main window after closing it.
 */
export function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const appName = app.getName()

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: appName,
            submenu: [
              { role: 'about', label: `${appName} 정보` },
              { type: 'separator' },
              { role: 'services', label: '서비스' },
              { type: 'separator' },
              { role: 'hide', label: `${appName} 숨기기` },
              { role: 'hideOthers', label: '다른 항목 숨기기' },
              { role: 'unhide', label: '모두 보기' },
              { type: 'separator' },
              { role: 'quit', label: `${appName} 종료` }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '전체 선택' }
      ]
    },
    {
      label: '보기',
      submenu: [
        { role: 'reload', label: '새로고침' },
        { role: 'forceReload', label: '강제 새로고침' },
        { role: 'toggleDevTools', label: '개발자 도구' },
        { type: 'separator' },
        { role: 'resetZoom', label: '실제 크기' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면 전환' }
      ]
    },
    {
      label: '윈도우',
      submenu: [
        { role: 'minimize', label: '최소화' },
        { role: 'close', label: '닫기' },
        ...(isMac
          ? ([
              { type: 'separator' },
              { role: 'front', label: '모두 앞으로 가져오기' }
            ] as MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      label: '도움말',
      submenu: [
        {
          label: 'Whisper / llama.cpp 모델에 대해',
          click: async (): Promise<void> => {
            await shell.openExternal('https://huggingface.co/ggerganov/whisper.cpp')
          }
        },
        {
          label: 'Notion API 문서',
          click: async (): Promise<void> => {
            await shell.openExternal('https://developers.notion.com/')
          }
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
