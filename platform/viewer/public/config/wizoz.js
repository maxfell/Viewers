window.config = {
  routerBasename: '/',
  showStudyList: true,
  extensions: [],
  modes: [],
  // below flag is for performance reasons, but it might not work for all servers
  omitQuotationForMultipartRequest: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  dataSources: [
    {
      friendlyName: 'WizOz Server',
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        name: 'Orthanc',
        wadoUriRoot: '/pacs/wado',
        qidoRoot: '/pacs/dicom-web',
        wadoRoot: '/pacs/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
      },
    },
  ],
  defaultDataSourceName: 'dicomweb',
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        'a',
        {
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'text-white underline',
          href: '#',
        },
        React.createElement('h5', {}, 'WizOz DICOM Viewer')
      );
    },
  },
};
