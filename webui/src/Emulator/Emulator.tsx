import React, { useCallback, useEffect, useMemo, useState, useContext } from 'react'
import {
	LoadingRetryOrError,
	applyPatchOrReplaceObject,
	MyErrorBoundary,
	SocketContext,
	socketEmitPromise,
	useMountEffect,
	PreventDefaultHandler,
} from '../util.js'
import { CButton, CCol, CForm, CRow } from '@coreui/react'
import { nanoid } from 'nanoid'
import { useParams } from 'react-router-dom'
import { dsanMastercueKeymap, keyboardKeymap, logitecKeymap } from './Keymaps.js'
import { ButtonPreview } from '../Components/ButtonPreview.js'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCancel, faExpand } from '@fortawesome/free-solid-svg-icons'
import { ControlLocation, EmulatorConfig, EmulatorImage } from '@companion/shared/Model/Common.js'
import { Operation as JsonPatchOperation } from 'fast-json-patch'

type EmulatorImageCache = Record<number, Record<number, string | false | undefined> | undefined>

export function Emulator() {
	const socket = useContext(SocketContext)

	const [config, setConfig] = useState<EmulatorConfig | null>(null)
	const [loadError, setLoadError] = useState<string | null>(null)

	const { id: emulatorId } = useParams()

	const [imageCache, setImageCache] = useState<EmulatorImageCache>({})
	useEffect(() => {
		// Clear the images on id change
		setImageCache({})
	}, [emulatorId])

	const [retryToken, setRetryToken] = useState(nanoid())
	const doRetryLoad = useCallback(() => setRetryToken(nanoid()), [])
	useEffect(() => {
		setConfig(null)
		setLoadError(null)

		socketEmitPromise(socket, 'emulator:startup', [emulatorId])
			.then((config) => {
				setConfig(config)
			})
			.catch((e: any) => {
				console.error('Emulator error', e)
				setLoadError(`Failed: ${e}`)
			})

		const updateConfig = (patch: JsonPatchOperation[]) => {
			setConfig((oldConfig) => oldConfig && applyPatchOrReplaceObject(oldConfig, patch))
		}

		socket.on('emulator:config', updateConfig)

		return () => {
			socket.off('emulator:config', updateConfig)
		}
	}, [retryToken, socket, emulatorId])

	const keymap = useMemo(() => {
		if (config?.emulator_control_enable) {
			return { ...keyboardKeymap, ...logitecKeymap, ...dsanMastercueKeymap }
		} else {
			return keyboardKeymap
		}
	}, [config?.emulator_control_enable])

	useEffect(() => {
		const updateImages = (newImages: EmulatorImage[]) => {
			console.log('new images', newImages)
			setImageCache((old) => {
				if (Array.isArray(newImages)) {
					const res = { ...old }

					for (const change of newImages) {
						const row = (res[change.y] = { ...res[change.y] })
						row[change.x] = change.buffer
					}

					return res
				} else {
					return newImages
				}
			})
		}

		socket.on('emulator:images', updateImages)

		return () => {
			socket.off('emulator:images', updateImages)
		}
	}, [socket, imageCache])

	useEffect(() => {
		const onConnect = () => {
			setRetryToken(nanoid())
		}
		socket.on('connect', onConnect)
		return () => {
			socket.off('connect', onConnect)
		}
	}, [socket])

	const [keyDown, setKeyDown] = useState<ControlLocation | null>(null)

	// Register key handlers
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (keymap[e.keyCode] !== undefined) {
				const xy = keymap[e.keyCode]
				if (xy) {
					socketEmitPromise(socket, 'emulator:press', [emulatorId, ...xy]).catch((e: any) => {
						console.error('press failed', e)
					})
					console.log('emulator:press', emulatorId, xy)
				}
			}
		}

		const onKeyUp = (e: KeyboardEvent) => {
			const xy = keymap[e.keyCode]
			if (xy) {
				socketEmitPromise(socket, 'emulator:release', [emulatorId, ...xy]).catch((e: any) => {
					console.error('release failed', e)
				})
				console.log('emulator:release', emulatorId, xy)
			}
		}

		document.addEventListener('keydown', onKeyDown)
		document.addEventListener('keyup', onKeyUp)

		return () => {
			document.removeEventListener('keydown', onKeyDown)
			document.removeEventListener('keyup', onKeyUp)
		}
	}, [socket, keymap, emulatorId])

	useEffect(() => {
		// handle changes to keyDown, as it isnt safe to do inside setState
		if (!keyDown) return

		socketEmitPromise(socket, 'emulator:press', [emulatorId, keyDown.column, keyDown.row]).catch((e: any) => {
			console.error('press failed', e)
		})
		console.log('emulator:press', emulatorId, keyDown)

		return () => {
			socketEmitPromise(socket, 'emulator:release', [emulatorId, keyDown.column, keyDown.row]).catch((e: any) => {
				console.error('release failed', e)
			})
			console.log('emulator:release', emulatorId, keyDown)
		}
	}, [socket, keyDown, emulatorId])

	useEffect(() => {
		const onMouseUp = (e: MouseEvent) => {
			e.preventDefault()
			setKeyDown(null)
		}

		document.body.addEventListener('mouseup', onMouseUp)

		return () => {
			document.body.removeEventListener('mouseup', onMouseUp)
			setKeyDown(null)
		}
	}, [])

	return (
		<div className="page-tablet page-emulator">
			{config ? (
				<>
					<ConfigurePanel config={config} />

					<EmulatorButtons
						imageCache={imageCache}
						setKeyDown={setKeyDown}
						columns={config.emulator_columns}
						rows={config.emulator_rows}
					/>
				</>
			) : (
				<CRow className={'loading'}>
					<LoadingRetryOrError dataReady={false} error={loadError} doRetry={doRetryLoad} />
				</CRow>
			)}
		</div>
	)
}

interface ConfigurePanelProps {
	config: EmulatorConfig
}

function ConfigurePanel({ config }: ConfigurePanelProps): JSX.Element | null {
	const [show, setShow] = useState(true)
	const [fullscreen, setFullscreen] = useState(document.fullscreenElement !== null)

	useMountEffect(() => {
		const handleChange = () => {
			console.log('fullscreen change')
			setFullscreen(document.fullscreenElement !== null)
		}

		document.addEventListener('fullscreenchange', handleChange)
		return () => {
			document.removeEventListener('fullscreenchange', handleChange)
		}
	})

	const doRequestFullscreen = useCallback(() => {
		document.documentElement.requestFullscreen()
	}, [])
	const doDismiss = useCallback(() => {
		setShow(false)
	}, [])

	return show && config.emulator_prompt_fullscreen && !fullscreen ? (
		<CRow className="configure">
			<CCol sm={12}>
				<CForm onSubmit={PreventDefaultHandler}>
					<CRow>
						<CCol xs={12}>
							<CButton onClick={doRequestFullscreen} title="Fullscreen">
								<FontAwesomeIcon icon={faExpand} /> Fullscreen
							</CButton>
							<CButton onClick={doDismiss} title="Dismiss">
								<FontAwesomeIcon icon={faCancel} /> Dismiss
							</CButton>
						</CCol>
					</CRow>
				</CForm>
			</CCol>
		</CRow>
	) : null
}

interface EmulatorButtonsProps {
	imageCache: EmulatorImageCache
	setKeyDown: (location: ControlLocation | null) => void
	columns: number
	rows: number
}

function EmulatorButtons({ imageCache, setKeyDown, columns, rows }: EmulatorButtonsProps) {
	const buttonClick = useCallback(
		(location: ControlLocation, pressed: boolean) => {
			if (pressed) {
				setKeyDown(location)
			} else {
				setKeyDown(null)
			}
		},
		[setKeyDown]
	)

	const gridStyle = useMemo(() => {
		return {
			gridTemplateColumns: 'minmax(0, 1fr) '.repeat(columns),
			gridTemplateRows: 'minmax(0, 1fr) '.repeat(rows),
			aspectRatio: `${columns} / ${rows}`,
			height: `min(calc(100vw / ${columns} * ${rows}), 100vh)`,
			width: `min(calc(100vh / ${rows} * ${columns}), 100vw)`,
		}
	}, [rows, columns])

	const buttonElms = []
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < columns; x++) {
			buttonElms.push(
				<ButtonPreview2 key={`${y}/${x}`} column={x} row={y} preview={imageCache[y]?.[x]} onClick={buttonClick} />
			)
		}
	}

	return (
		<MyErrorBoundary>
			<div className="emulatorgrid">
				<div className="buttongrid" style={gridStyle}>
					{buttonElms}
				</div>
			</div>
		</MyErrorBoundary>
	)
}

interface ButtonPreview2Props {
	column: number
	row: number

	preview: string | undefined | null | false
	onClick: (location: ControlLocation, pressed: boolean) => void
}
function ButtonPreview2({ column, row, ...props }: ButtonPreview2Props) {
	const location = useMemo(() => ({ pageNumber: 0, column, row }), [column, row])
	return <ButtonPreview {...props} location={location} title={`Button ${column}/${row}`} />
}
