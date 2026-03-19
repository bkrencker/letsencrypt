using { my } from '../db/data-model';

@path: '/catalog'
@(requires: ['authenticated-user'])
service CatalogService {
    @readonly entity Environments as projection on my.Environments order by code desc;
    @readonly entity CertificateStatuses as projection on my.CertificateStatuses;
    @readonly entity CertificateDomains as projection on my.CertificateDomains;

    @readonly entity Routes as projection on my.Routes;

    entity Certificates as projection on my.Certificates actions {
        /**
         * Create Certificate from CSR
         */
        @(
            cds.odata.bindingparameter.name : '_me',
            Core.OperationAvailable: _me.isCertificateCreateable,
            Common.IsActionCritical: true // show confirmation popup
        )
        action createFromCsr(
            @(
                UI.ParameterDefaultValue : _me.domain,
                Common.FieldControl: { $value: #Mandatory }
            )
            domain: String,

            @(Common : { 
                FieldControl : #Mandatory,
                ValueListWithFixedValues: true, 
                ValueList : { 
                    Label : '{i18n>ChangeEvent}', 
                    CollectionPath : 'Environments', 
                    Parameters : [ 
                        { $Type : 'Common.ValueListParameterInOut', ValueListProperty : 'code', LocalDataProperty : code }, 
                        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name', } 
                    ] 
                } 
            },
            UI.ParameterDefaultValue : 'T')
            code: type of Environments:code not null
        );


        /**
         * Recreate CSR from existing
         * Show dialog with mandatory field. 
         * Domain-value is taken from entity context.
         * App is automatically refreshed afterwards.
         */
        @(
            cds.odata.bindingparameter.name : '_me',
            Core.OperationAvailable: _me.isRecreatable,
            Common.IsActionCritical: true, // show confirmation popup
        )
        action recreateCsrFromExisting(
            @(
                UI.ParameterDefaultValue : _me.domain,
                Common.FieldControl : { $value: #Mandatory }
            )
            domain: String not null,
            
            @Common.FieldControl : { $value: #Mandatory }
            alias: String not null,
        ) returns Certificates;

        /**
         * Renew Certificate and activate
         * Show dialog with mandatory field. 
         * Domain-value is taken from entity context.
         * App is automatically refreshed afterwards.
         */
        @(
            cds.odata.bindingparameter.name : '_me',
            Core.OperationAvailable: _me.isRecreatable,
            Common.IsActionCritical: true, // show confirmation popup
        )
        action renewAndActivate(
            @(
                UI.ParameterDefaultValue : _me.domain,
                Common.FieldControl : { $value: #Mandatory }
            )
            domain: String not null,
            
            @Common.FieldControl : { $value: #Mandatory }
            alias: String not null,

            @(Common : { 
                FieldControl : #Mandatory,
                ValueListWithFixedValues: true, 
                ValueList : { 
                    Label : '{i18n>ChangeEvent}', 
                    CollectionPath : 'Environments', 
                    Parameters : [ 
                        { $Type : 'Common.ValueListParameterInOut', ValueListProperty : 'code', LocalDataProperty : code }, 
                        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name', } 
                    ] 
                } 
            },
            UI.ParameterDefaultValue : 'T')
            code: type of Environments:code not null
        ) returns Certificates;

        /**
         * Activate Certificate
         * Show Domain in Read-Only mode
         * App is automatically refreshed afterwards.
         */
        @(
            cds.odata.bindingparameter.name : '_me',
            Core.OperationAvailable: _me.isActivateable,
            Common.IsActionCritical: true, // show confirmation popup
        )
        action activateCertificate(          
            @(
                UI.ParameterDefaultValue : _me.domain,
                Common.FieldControl: { $value: #Mandatory }
            )
            domain: String not null
        );

        /**
         * Check Route in Cloud Foundry
         * Show Domain Parameter in Read-Only mode
         * App is automatically refreshed afterwards.
         */
        @(
            cds.odata.bindingparameter.name : '_me',
            Core.OperationAvailable: _me.hasOnlyOneDomainSAN
        )
        action checkRoute(          
            @(
                UI.ParameterDefaultValue : _me.domain,
                Common.FieldControl: { $value: #Mandatory }
            )
            domain: String
        );

        /**
         * Create Route in Cloud Foundry
         * Show Domain Parameter in Read-Only mode
         * App is automatically refreshed afterwards.
         */
        @(
            cds.odata.bindingparameter.name : '_me',
            Core.OperationAvailable: _me.hasOnlyOneDomainSAN
        )
        action createRoute(          
            @(
                UI.ParameterDefaultValue : _me.domain,
                Common.FieldControl: { $value: #Mandatory }
            )
            domain: String,

            @(
                UI.ParameterDefaultValue : _me.route_path,
                UI.Hidden
            )
            route: String,
        );

        /**
         * Deactivate Certificate
         * Show Domain Parameter in Read-Only mode
         * App is automatically refreshed afterwards.
         */
        @(
            cds.odata.bindingparameter.name : '_me',
            Core.OperationAvailable: _me.isDeactivateable,
            Common.IsActionCritical: true, // show confirmation popup
        )
        action deactivateCertificate(          
            @(
                UI.ParameterDefaultValue : _me.domain,
                Common.FieldControl: { $value: #Mandatory }
            )
            domain: String
        );

    };

    /**
     * Create new CSR from Scratch
     */
    action createNewCsr(
        @Common.FieldControl : { $value: #Mandatory }
        alias: String not null,

        @(
            UI.ParameterDefaultValue : 'DOMAIN.apps.example.com',
            Common.FieldControl: { $value: #Mandatory }
        )
        domain: String not null
    ) returns Certificates;

    @readonly entity Domains as projection on my.Domains;


    /**
     * Test with GET http://localhost:4004/catalog/renewCertificates(test=true) -> Certificates cannot be created locally
     * Manual Test on BTP (using Approuter): https://<subaccount>-<space>-letsencrypt-app.cfapps.eu10.hana.ondemand.com/catalog/renewCertificates(test=true)
     * Manual Run on BTP (using Approuter): https://<subaccount>-<space>-letsencrypt-app.cfapps.eu10.hana.ondemand.com/catalog/renewCertificates
     * Scheduled Run (without Approuter!): https://<subaccount>-<space>-letsencrypt-srv.cfapps.eu10.hana.ondemand.com/catalog/renewCertificates
     */
    @(requires: ['authenticated-user', 'jobscheduler'])
    function renewCertificates(test:Boolean) returns String;

    /**
     * Test with GET http://localhost:4004/catalog/deleteExpiredCertificates(test=true) -> no deletion in test mode
     * Manual Run on BTP (using Approuter): https://<subaccount>-<space>-letsencrypt-app.cfapps.eu10.hana.ondemand.com/catalog/deleteExpiredCertificates
     * Scheduled Run (without Approuter!): https://<subaccount>-<space>-letsencrypt-srv.cfapps.eu10.hana.ondemand.com/catalog/deleteExpiredCertificates
     */
    @(requires: ['authenticated-user', 'jobscheduler'])
    function deleteExpiredCertificates(test:Boolean) returns String;

    /**
     * Check if Job Scheduler contains an active job named "Renew Active Certificates"
     * and an active schedule named "Weekly".
     */
    @(requires: ['authenticated-user', 'jobscheduler'])
    action checkRenewCertificatesScheduler() returns String;

    /**
     * Enable all schedules of the job "Renew Active Certificates".
     */
    @(requires: ['authenticated-user', 'jobscheduler'])
    action enableRenewCertificatesScheduler() returns String;

    /**
     * Disable all schedules of the job "Renew Active Certificates".
     */
    @(requires: ['authenticated-user', 'jobscheduler'])
    action disableRenewCertificatesScheduler() returns String;

    /**
     * Create the job "Renew Active Certificates" and its schedule "Weekly".
     */
    @(requires: ['authenticated-user', 'jobscheduler'])
    action createRenewCertificatesScheduler() returns String;

    /**
     * Delete the job "Renew Active Certificates".
     */
    @(requires: ['authenticated-user', 'jobscheduler'])
    action deleteRenewCertificatesScheduler() returns String;

}