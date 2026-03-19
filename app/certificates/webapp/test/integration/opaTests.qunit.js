sap.ui.require(
    [
        'sap/fe/test/JourneyRunner',
        'certificates/test/integration/FirstJourney',
		'certificates/test/integration/pages/CertificatesList',
		'certificates/test/integration/pages/CertificatesObjectPage'
    ],
    function(JourneyRunner, opaJourney, CertificatesList, CertificatesObjectPage) {
        'use strict';
        var JourneyRunner = new JourneyRunner({
            // start index.html in web folder
            launchUrl: sap.ui.require.toUrl('certificates') + '/index.html'
        });

       
        JourneyRunner.run(
            {
                pages: { 
					onTheCertificatesList: CertificatesList,
					onTheCertificatesObjectPage: CertificatesObjectPage
                }
            },
            opaJourney.run
        );
    }
);