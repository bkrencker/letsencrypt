using CatalogService as service from '../../srv/cat-service';

/**
 * Activate in order to have default DELETE action
 */
annotate service.Certificates with @fiori.draft.enabled;

/**
 * Dynamically activate DELETE button
 */
annotate service.Certificates with @Capabilities.DeleteRestrictions : {
    $Type : 'Capabilities.DeleteRestrictionsType',
    Deletable: isDeleteable
};


annotate service.Certificates with @(
    UI.HeaderFacets       : [{
        $Type  : 'UI.ReferenceFacet',
        Label  : 'Zertifikat',
        ID     : 'header',
        Target : '@UI.FieldGroup#header',
    }, 
    {
        $Type : 'UI.ReferenceFacet',
        Target : '@UI.DataPoint#Progress',
    },],
    UI.FieldGroup #header : {
        $Type : 'UI.FieldGroupType',
        Data  : [{
            $Type : 'UI.DataField',
            Value : alias,
            Label : 'alias',
            Criticality : criticality,
        }, ],
    },
    UI.DataPoint #Progress: {
        Value: expiration_percent,
        TargetValue: 100,
        Title: 'Expiration',
        Visualization: #Progress,
        Criticality : criticality,
    }
);

annotate service.Certificates with @(UI.LineItem : [
    {
        $Type : 'UI.DataField',
        Value : alias,
        Label : 'Alias',
        Criticality : criticality,
    },
    {
        $Type : 'UI.DataField',
        Value : domain,
        Label : 'Domain',
        Criticality : criticality,
        CriticalityRepresentation: #WithoutIcon
    },
    {
        $Type : 'UI.DataField',
        Value : landscape,
        Label : 'Landscape',
    },
    {
        $Type : 'UI.DataFieldForAnnotation',
        Target : '@UI.DataPoint#expiration_percent',
        Label : 'Expiration [%]',
    },
    {
        $Type : 'UI.DataField',
        Value : expiration_days,
        Label : 'Days left',
        Criticality : criticality,
        CriticalityRepresentation : #WithoutIcon,
    },
    {
        $Type : 'UI.DataField',
        Value : date_begin,
        Label : 'Start',
    },
    {
        $Type : 'UI.DataField',
        Value : date_end,
        Label : 'End',
        Criticality : criticality,
        CriticalityRepresentation : #WithoutIcon,
    },
    {
        $Type : 'UI.DataField',
        Value : expired,
        Label : 'Expired',
    },
    {
        $Type : 'UI.DataField',
        Value : status,
        Label : 'Status',
    },
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.EntityContainer/createNewCsr',
        Label : 'New',
    },
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.EntityContainer/checkRenewCertificatesScheduler',
        Label : 'Check Scheduler',
    },
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.EntityContainer/enableRenewCertificatesScheduler',
        Label : 'Enable Scheduler',
    },
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.EntityContainer/disableRenewCertificatesScheduler',
        Label : 'Disable Scheduler',
    },
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.EntityContainer/createRenewCertificatesScheduler',
        Label : 'Create Scheduler',
    },
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.EntityContainer/deleteRenewCertificatesScheduler',
        Label : 'Delete Scheduler',
    },
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.recreateCsrFromExisting',
        Label : 'Duplicate',
    },
    {
        $Type  : 'UI.DataFieldForAction',
        Action : 'CatalogService.createFromCsr',
        Label  : 'Generate Certificate',
    },
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.activateCertificate',
        Label : 'Activate',
    },
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.deactivateCertificate',
        Label : 'Deactivate',
    },
]);

annotate service.Certificates with @(
    UI.SelectionFields : [
        domain,
        status,
        expired,
    ]
);

annotate service.Certificates with {
    domain @(
        Common.Text : {
            $value : domain,
        },
        Common.TextArrangement : #TextOnly,
        Common.ValueListWithFixedValues : true,
        Common.ValueList : {
            Label : 'Domain',
            CollectionPath : 'CertificateDomains',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    ValueListProperty : 'code',
                    LocalDataProperty : domain,
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'name',
                },
            ],
        },
    );

    status @(
        Common.Text : {
            $value : status,
        },
        Common.TextArrangement : #TextOnly,
        Common.ValueListWithFixedValues : true,
        Common.ValueList : {
            Label : 'Status',
            CollectionPath : 'CertificateStatuses',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    ValueListProperty : 'code',
                    LocalDataProperty : status,
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'name',
                },
            ],
        },
    );
};

annotate service.Certificates with @(
    UI.Facets           : [{
        $Type  : 'UI.ReferenceFacet',
        Label  : 'Zertifikat',
        ID     : 'form',
        Target : '@UI.FieldGroup#form',
    },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Domains',
            ID : 'Domains',
            Target : 'sans/@UI.LineItem#Domains',
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Route',
            ID : 'Route',
            Target : '@UI.FieldGroup#Route',
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Links',
            ID : 'Links',
            Target : '@UI.FieldGroup#Links',
        }, ],
    UI.FieldGroup #form : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            {
                $Type : 'UI.DataField',
                Value : domain,
                Label : 'Domäne'
            },
            {
                $Type : 'UI.DataField',
                Value : date_begin,
                Label : 'date_begin',
            },
            {
                $Type : 'UI.DataField',
                Value : date_end,
                Label : 'date_end',
                Criticality : criticality,
                CriticalityRepresentation : #WithoutIcon,
            },
            {
                $Type : 'UI.DataField',
                Value : expiration_days,
                Label : 'expiration_days',
                Criticality : criticality,
                CriticalityRepresentation : #WithoutIcon,
            },
            {
                $Type : 'UI.DataField',
                Value : expiration_percent,
                Label : 'expiration_percent',
            },
            {
                $Type : 'UI.DataField',
                Value : expiration_severity,
                Label : 'expiration_severity',
            },
            {
                $Type : 'UI.DataField',
                Value : expired,
                Label : 'expired',
            },
            {
                $Type : 'UI.DataField',
                Value : GUID,
                Label : 'GUID',
            },
            {
                $Type : 'UI.DataField',
                Value : status,
                Label : 'status',
            },
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'CatalogService.createFromCsr',
                Label : 'Generate',
            },
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'CatalogService.EntityContainer/createNewCsr',
                Label : 'Duplicate',
            },
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'CatalogService.activateCertificate',
                Label : 'Activate',
            },
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'CatalogService.deactivateCertificate',
                Label : 'Deactivate',
            },
            {
                $Type : 'UI.DataField',
                Value : landscape,
                Label : 'Landscape',
            },
        ],
    }
);

annotate service.Certificates with @(UI.HeaderInfo : {
    Title          : {
        $Type : 'UI.DataField',
        Value : alias,
    },
    TypeName       : 'Certificate',
    TypeNamePlural : 'Certificates',
});

annotate service.Certificates with @(UI.Identification : [
    {
        $Type : 'UI.DataFieldForAction',
        Action : 'CatalogService.renewAndActivate',
        Label : 'Renew and Activate',
    },]);

annotate service.Domains with @(UI.LineItem : [
    {
        $Type : 'UI.DataField',
        Value : alias,
        Label : 'alias',
    },
]);

annotate service.Domains with @(
    UI.LineItem #Domains : [
        {
            $Type : 'UI.DataField',
            Value : alias,
            Label : 'alias',
        },]
);
annotate service.Certificates with @(
    UI.DataPoint #expiration_percent : {
        Value : expiration_percent,
        Visualization : #Progress,
        TargetValue : 100,
        Criticality : criticality,
        CriticalityRepresentation : #WithoutIcon,
    }
);
annotate service.Certificates with @(
    UI.FieldGroup #Links : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataFieldWithUrl',
                Url : 'https://yourorganization.custom-domains.cf.eu10.hana.ondemand.com/',
                Value : 'https://yourorganization.custom-domains.cf.eu10.hana.ondemand.com/',
                Label : 'BTP Custom Domains',
            },],
    }
);
annotate service.Certificates with @(
    UI.FieldGroup #Route : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'CatalogService.checkRoute',
                Label : 'Check Route',
            },
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'CatalogService.createRoute',
                Label : 'Create Route',
            },
            {
                $Type : 'UI.DataFieldWithUrl',
                Value : route_path,
                Url: route_path,
                Label : 'Let''s Encrypt Check URL',
            },],
    }
);
