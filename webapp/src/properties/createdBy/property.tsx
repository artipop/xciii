import {IntlShape} from '../../intl'

import {PropertyType, PropertyTypeEnum, FilterValueType} from '../types'

import CreatedBy from './createdBy'

export default class CreatedByProperty extends PropertyType {
    Editor = CreatedBy
    name = 'Created By'
    type = 'createdBy' as PropertyTypeEnum
    isReadOnly = true
    displayName = (intl: IntlShape) => intl.formatMessage({id: 'PropertyType.CreatedBy', defaultMessage: 'Created by'})
    canFilter = true
    filterValueType = 'person' as FilterValueType
    canGroup = true
}
