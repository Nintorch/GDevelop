// @flow
import { Trans } from '@lingui/macro';

import React from 'react';
import RaisedButton from '../../UI/RaisedButton';
import { Column, Line } from '../../UI/Grid';
import { findGDJS } from '../../GameEngineFinder/LocalGDJSFinder';
import LocalFileSystem, { type UrlFileDescriptor } from './LocalFileSystem';
import LocalFilePicker from '../../UI/LocalFilePicker';
import assignIn from 'lodash/assignIn';
import optionalRequire from '../../Utils/OptionalRequire';
import {
  type ExportFlowProps,
  type ExportPipeline,
  type ExportPipelineContext,
} from '../ExportPipeline.flow';
import {
  ExplanationHeader,
  DoneFooter,
  ExportFlow,
} from '../GenericExporters/ElectronExport';
import { downloadUrlsToLocalFiles } from '../../Utils/LocalFileDownloader';
// It's important to use remote and not electron for folder actions,
// otherwise they will be opened in the background.
// See https://github.com/electron/electron/issues/4349#issuecomment-777475765
const remote = optionalRequire('@electron/remote');
const shell = remote ? remote.shell : null;
const path = optionalRequire('path');
const fs = window.require ? window.require('fs') : undefined;
const electron = optionalRequire('electron');
const { ipcRenderer } = electron || {};

const gd: libGDevelop = global.gd;

type ExportState = {
  outputFile: string,
};

type PreparedExporter = {|
  exporter: gdjsExporter,
  localFileSystem: LocalFileSystem,
|};

type ExportOutput = {|
  urlFiles: Array<UrlFileDescriptor>,
|};

type ResourcesDownloadOutput = null;

type CompressionOutput = null;

const exportPipelineName = 'local-electron';

export const localBuildToolsElectronExportPipeline: ExportPipeline<
  ExportState,
  PreparedExporter,
  ExportOutput,
  ResourcesDownloadOutput,
  CompressionOutput
> = {
  name: exportPipelineName,
  packageNameWarningType: 'desktop',

  getInitialExportState: (project: gdProject) => ({
    outputFile: "",
  }),

  canLaunchBuild: exportState => !!exportState.outputFile,

  isNavigationDisabled: () => false,

  renderHeader: ({ project, exportState, updateExportState, exportStep }) =>
    exportStep !== 'done' ? (
      <Column noMargin expand>
        <Line>
          <Column noMargin>
            <ExplanationHeader />
          </Column>
        </Line>
        <Line>
          <LocalFilePicker
            title={'Choose the path for your exported game'}
            message={
              'Choose where to save the exported file for your game'
            }
            filters={[
              {
                name: 'Windows Executable',
                extensions: ['exe'],
              },
            ]}
            value={exportState.outputFile}
            onChange={value =>
              updateExportState(() => ({ outputFile: value }))
            }
            fullWidth
          />
        </Line>
      </Column>
    ) : null,

  renderExportFlow: (props: ExportFlowProps) => (
    <ExportFlow {...props} exportPipelineName={exportPipelineName} />
  ),

  prepareExporter: (
    context: ExportPipelineContext<ExportState>
  ): Promise<PreparedExporter> => {
    return findGDJS().then(({ gdjsRoot }) => {
      console.info('GDJS found in ', gdjsRoot);

      // TODO: Memory leak? Check for other exporters too.
      const localFileSystem = new LocalFileSystem({
        downloadUrlsToLocalFiles: true,
      });
      const fileSystem = assignIn(
        new gd.AbstractFileSystemJS(),
        localFileSystem
      );
      const exporter = new gd.Exporter(fileSystem, gdjsRoot);

      return {
        exporter,
        localFileSystem,
      };
    });
  },

  launchExport: async (
    context: ExportPipelineContext<ExportState>,
    { exporter, localFileSystem }: PreparedExporter,
    fallbackAuthor: ?{ id: string, username: string }
  ): Promise<ExportOutput> => {
    let outputDir: string = path.join(await ipcRenderer.invoke("get-user-data"), "Build Tools", "Electron", "Build");
    const exportOptions = new gd.ExportOptions(
      context.project,
      outputDir
    );
    exportOptions.setTarget('electron');
    if (fallbackAuthor) {
      exportOptions.setFallbackAuthor(
        fallbackAuthor.id,
        fallbackAuthor.username
      );
    }
    exporter.exportWholePixiProject(exportOptions);
    
    let configFilePath = path.join(outputDir, "build.js");
    // TODO: it shouldn't be Windows-only and it shouldn't be duplicate between this file and the other Electron export file
    let data = `
      const builder = require("electron-builder");
      builder.build({
        targets: builder.Platform.WINDOWS.createTarget(),
        config: {
          win: {
            target: 'portable'
          },
          artifactName: "result.exe",
        }
      });
    `;
    fs.writeFileSync(configFilePath, data);

    await ipcRenderer.invoke("child-process", "node build.js", outputDir);
    fs.cpSync(
      path.join(outputDir, "dist", "result.exe"),
      context.exportState.outputFile
    );

    // TODO: cleanup, application information, icon

    exportOptions.delete();
    exporter.delete();

    return {
      urlFiles: localFileSystem.getAllUrlFilesIn(outputDir),
    };
  },

  launchResourcesDownload: async (
    context: ExportPipelineContext<ExportState>,
    { urlFiles }: ExportOutput
  ): Promise<ResourcesDownloadOutput> => {
    await downloadUrlsToLocalFiles({
      urlContainers: urlFiles,
      onProgress: context.updateStepProgress,
      throwIfAnyError: true,
    });

    return null;
  },

  launchCompression: (
    context: ExportPipelineContext<ExportState>,
    exportOutput: ResourcesDownloadOutput
  ): Promise<CompressionOutput> => {
    return Promise.resolve(null);
  },

  renderDoneFooter: ({ exportState }) => {
    const openExportFolder = () => {
      if (shell) shell.openPath(exportState.outputDir);
    };

    return (
      <DoneFooter
        renderGameButton={() => (
          <RaisedButton
            key="open"
            label={<Trans>Open folder</Trans>}
            primary={true}
            onClick={openExportFolder}
          />
        )}
      />
    );
  },
};
